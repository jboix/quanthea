/**
 * Notification channels as admins keep them: create, change, delete. The target and the signing
 * secret are sealed together, bound to the channel id; what comes back shows the target masked.
 */
import {
  type ChannelInput,
  type ChannelKind,
  type ChannelPatch,
  type ChannelView,
  channelInputSchema,
  channelKindInfo,
  channelKindSchema,
} from '@quanthea/shared';
import type { AuditRepository } from '../db/audit-repository.ts';
import type { ChannelRepository, ChannelRow } from '../db/channel-repository.ts';
import { AppError } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import type { SecretBox } from '../secrets/secret-box.ts';
import { refusedDestination } from './delivery.ts';

/** A channel as the service returns it: the view, with its creator's id rather than a name. */
export type ChannelInfo = Omit<ChannelView, 'createdBy'> & {
  /** The id of the admin who added it. */
  readonly createdById: string;
};

/** What is sealed: the target, and the generic webhook's signing secret. */
export interface SealedTarget {
  /** The webhook URL, or the routing key. */
  readonly target: string;
  /** The signing secret, when the channel signs. */
  readonly signingSecret?: string | undefined;
}

/** What the store needs. */
export interface StoreContext {
  /** Stores channels. */
  readonly repository: ChannelRepository;
  /** Seals targets. */
  readonly secretBox: SecretBox;
  /** Records who changed what. */
  readonly audit: AuditRepository;
  /** How many alerts send to a channel. */
  readonly alertsUsing: (channelId: string) => number;
  /** How many reports send to a channel. */
  readonly reportsUsing: (channelId: string) => number;
  /** Resolves a host name, to refuse a metadata address. */
  readonly resolve: (host: string) => Promise<readonly string[]>;
  /** The clock, in epoch milliseconds. */
  readonly now: () => number;
}

/**
 * What a target is sealed for: the channel, so a sealed value moved to another row does not open.
 *
 * @param id - The channel id.
 * @returns The owner.
 */
function ownerOf(id: string): string {
  return `notification-channel:${id}`;
}

/**
 * Masks a target: a URL keeps its host, its first path segment and its last four characters; a
 * routing key keeps its last four.
 *
 * @param kind - The channel kind.
 * @param target - The target.
 * @returns The masked target.
 */
export function maskTarget(kind: ChannelKind, target: string): string {
  const tail = target.slice(-4);
  if (channelKindInfo[kind].target === 'routing-key' || !URL.canParse(target)) return `••••${tail}`;
  const url = new URL(target);
  const [first] = url.pathname.split('/').filter(Boolean);
  if (!first) return url.host;
  return `${url.host}/${first}/…/${tail.replace(/^\/+/, '')}`;
}

/**
 * Opens a channel's sealed target.
 *
 * @param secretBox - The secret box.
 * @param row - The channel.
 * @returns The target and any signing secret.
 */
export async function openTarget(secretBox: SecretBox, row: ChannelRow): Promise<SealedTarget> {
  return JSON.parse(await secretBox.open(row.secret, ownerOf(row.id))) as SealedTarget;
}

/**
 * Seals a channel's target.
 *
 * @param secretBox - The secret box.
 * @param id - The channel id.
 * @param sealed - The target and any signing secret.
 * @returns The sealed bytes.
 */
export function sealTarget(
  secretBox: SecretBox,
  id: string,
  sealed: SealedTarget,
): Promise<Uint8Array> {
  return secretBox.seal(JSON.stringify(sealed), ownerOf(id));
}

/**
 * A stored channel as the service returns it.
 *
 * @param row - The channel.
 * @param alertsUsing - How many alerts send to a channel.
 * @returns The channel.
 */
export function toInfo(row: ChannelRow, alertsUsing: (channelId: string) => number): ChannelInfo {
  return {
    id: row.id,
    name: row.name,
    kind: channelKindSchema.parse(row.kind),
    target: row.targetHint,
    signed: row.signed,
    mentions: [...row.mentions],
    createdById: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastSentAt: row.lastSentAt,
    lastError: row.lastError,
    alerts: alertsUsing(row.id),
  };
}

/**
 * Finds a channel.
 *
 * @param context - The store.
 * @param id - The channel id.
 * @returns The channel.
 * @throws {AppError} `not_found` for an unknown id.
 */
export function channelRow(context: StoreContext, id: string): ChannelRow {
  const row = context.repository.get(id);
  if (!row) throw new AppError('not_found', 'There is no such channel.');
  return row;
}

/**
 * Refuses a channel that cannot be stored: a name taken by another, or a metadata address.
 *
 * @param context - The store.
 * @param channel - The channel as it would be stored.
 * @param id - Its id.
 * @throws {AppError} `conflict` for a taken name, `bad_request` for a refused target.
 */
async function refuseInvalid(context: StoreContext, channel: ChannelInput, id: string) {
  const taken = context.repository.list().some((row) => row.name === channel.name && row.id !== id);
  if (taken) throw new AppError('conflict', `A channel is already named ${channel.name}.`);
  if (channelKindInfo[channel.kind].target !== 'url') return;
  const refused = await refusedDestination(channel.target, context.resolve);
  if (refused)
    throw new AppError('bad_request', refused, [
      { part: 'body', path: 'target', message: refused },
    ]);
}

/**
 * Stores a channel's settings, sealing its target.
 *
 * @param context - The store.
 * @param channel - The validated channel.
 * @param base - Its id, its creator and creation time, and its status.
 * @returns The stored row.
 */
async function store(
  context: StoreContext,
  channel: ChannelInput,
  base: Pick<ChannelRow, 'id' | 'createdBy' | 'createdAt' | 'lastSentAt' | 'lastError'>,
): Promise<ChannelRow> {
  await refuseInvalid(context, channel, base.id);
  const { target, signingSecret } = channel;
  const row: ChannelRow = {
    ...base,
    name: channel.name,
    kind: channel.kind,
    targetHint: maskTarget(channel.kind, target),
    mentions: channel.mentions,
    signed: signingSecret !== undefined,
    secret: await sealTarget(context.secretBox, base.id, { target, signingSecret }),
    updatedAt: context.now(),
  };
  context.repository.save(row);
  return row;
}

/**
 * Adds a channel.
 *
 * @param context - The store.
 * @param input - The validated channel.
 * @param actor - Who adds it.
 * @returns The channel.
 */
export async function createChannel(
  context: StoreContext,
  input: ChannelInput,
  actor: string,
): Promise<ChannelInfo> {
  const base = { id: newId(), createdBy: actor, createdAt: context.now() };
  const row = await store(context, input, { ...base, lastSentAt: null, lastError: null });
  const detail = { name: row.name, kind: row.kind };
  context.audit.append({ actor, action: 'channel.create', target: row.id, detail });
  return toInfo(row, context.alertsUsing);
}

/**
 * Applies a change to a channel's settings and validates the result as a whole.
 *
 * @param current - The channel as stored, with its target opened, without its signing secret.
 * @param secret - The signing secret stored, if any.
 * @param patch - The change.
 * @returns The channel as it would be.
 * @throws {AppError} `bad_request` with the issues when the result is not a valid channel.
 */
function applyPatch(
  current: Omit<ChannelInput, 'signingSecret'>,
  secret: string | undefined,
  patch: ChannelPatch,
): ChannelInput {
  const { signingSecret: patched, ...changes } = patch;
  const signingSecret = patched === undefined ? secret : (patched ?? undefined);
  const merged = { ...current, ...changes, ...(signingSecret ? { signingSecret } : {}) };
  const parsed = channelInputSchema.safeParse(merged);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.map((issue) => ({
    part: 'body',
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
  throw new AppError('bad_request', 'The channel is invalid.', issues);
}

/**
 * Changes a channel. Its kind stays; its status stays.
 *
 * @param context - The store.
 * @param id - The channel id.
 * @param patch - The change.
 * @param actor - Who changes it.
 * @returns The channel.
 */
export async function updateChannel(
  context: StoreContext,
  id: string,
  patch: ChannelPatch,
  actor: string,
): Promise<ChannelInfo> {
  const row = channelRow(context, id);
  const { target, signingSecret } = await openTarget(context.secretBox, row);
  const kind = channelKindSchema.parse(row.kind);
  const current = { name: row.name, kind, target, mentions: [...row.mentions] };
  const next = applyPatch(current, signingSecret, patch);
  const stored = await store(context, next, row);
  const changed = Object.keys(patch);
  context.audit.append({ actor, action: 'channel.update', target: id, detail: { changed } });
  return toInfo(stored, context.alertsUsing);
}

/**
 * Deletes a channel no alert or report sends to, with its log.
 *
 * @param context - The store.
 * @param id - The channel id.
 * @param actor - Who deletes it.
 * @throws {AppError} `not_found` for an unknown id, `conflict` while alerts or reports send to it.
 */
export function removeChannel(context: StoreContext, id: string, actor: string): void {
  const row = channelRow(context, id);
  const users = [
    { count: context.alertsUsing(id), one: 'alert' },
    { count: context.reportsUsing(id), one: 'report' },
  ];
  for (const { count, one } of users) {
    if (count === 0) continue;
    const words = count === 1 ? `1 ${one} sends` : `${count} ${one}s send`;
    throw new AppError('conflict', `${words} to this channel. Take it off them first.`);
  }
  context.repository.remove(id);
  context.audit.append({ actor, action: 'channel.delete', target: id, detail: { name: row.name } });
}
