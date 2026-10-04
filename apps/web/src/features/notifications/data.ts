/** Settings → Notifications: the loader, and the action that adds, changes, tests and deletes. */
import {
  type ChannelKind,
  type ChannelSend,
  type ChannelView,
  createChannelEndpoint,
  deleteChannelEndpoint,
  listChannelSendsEndpoint,
  listChannelsEndpoint,
  previewNotificationEndpoint,
  type SendResult,
  sampleMessage,
  testChannelEndpoint,
  updateChannelEndpoint,
} from '@quanthea/shared';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { z } from 'zod';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';

/** What the notifications screen shows. */
export interface NotificationsData {
  /** Every channel, by name. */
  readonly channels: readonly ChannelView[];
  /** What a generic webhook receives for the sample message. */
  readonly webhookExample: unknown;
}

/** The fields of the channel form, as typed. */
export interface ChannelFields {
  /** The channel's name. */
  readonly name: string;
  /** The channel kind; fixed once the channel exists. */
  readonly kind: ChannelKind;
  /** The URL or routing key; empty on an edit keeps the stored one. */
  readonly target: string;
  /** The signing secret; empty keeps the stored one. */
  readonly signingSecret: string;
  /** Whether to stop signing. */
  readonly unsign: boolean;
  /** The mentions, one per line. */
  readonly mentions: string;
}

/** What the screen submits, as JSON. */
export type NotificationsIntent =
  | { readonly intent: 'create'; readonly fields: ChannelFields }
  | { readonly intent: 'update'; readonly channelId: string; readonly fields: ChannelFields }
  | { readonly intent: 'delete'; readonly channelId: string }
  | { readonly intent: 'test'; readonly channelId: string }
  | { readonly intent: 'sends'; readonly channelId: string };

/** What an intent answers. */
export type NotificationsOutcome =
  | { readonly ok: true; readonly channel?: ChannelView }
  | { readonly ok: true; readonly test: SendResult }
  | { readonly ok: true; readonly sends: readonly ChannelSend[] }
  | {
      readonly ok: false;
      readonly message: string;
      readonly issues: Readonly<Record<string, string>>;
    };

/** The issues the server sends with `bad_request`. */
const issuesSchema = z.array(z.object({ part: z.string(), path: z.string(), message: z.string() }));

/**
 * Keys the server's validation issues by field.
 *
 * @param details - The `details` of the error.
 * @returns The first message of each field.
 */
function issuesByField(details: unknown): Record<string, string> {
  const parsed = issuesSchema.safeParse(details);
  if (!parsed.success) return {};
  const keyed = parsed.data.map(
    (issue) => [issue.path.split('.')[0] ?? '', issue.message] as const,
  );
  return Object.fromEntries(keyed.reverse());
}

/**
 * The loader of the notifications screen: the channels, and the webhook example.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadNotifications(api: ApiClient) {
  return async ({ request }: LoaderFunctionArgs): Promise<NotificationsData> => {
    const { signal } = request;
    const body = { kind: 'webhook' as const, ...sampleMessage };
    const [{ channels }, { previews }] = await Promise.all([
      api.call(listChannelsEndpoint, undefined, { signal }),
      api.call(previewNotificationEndpoint, { body }, { signal }),
    ]);
    return { channels, webhookExample: previews[0]?.body };
  };
}

/**
 * The mentions typed, one per line or separated by spaces.
 *
 * @param text - The text.
 * @returns The mentions.
 */
function mentionsOf(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/**
 * The body of a new channel.
 *
 * @param fields - The form's fields.
 * @returns The body.
 */
function createBody(fields: ChannelFields) {
  const { name, kind, target, signingSecret } = fields;
  const mentions = mentionsOf(fields.mentions);
  return { name, kind, target, mentions, ...(signingSecret ? { signingSecret } : {}) };
}

/**
 * The body of a change: the target and secret only when typed, so empty fields keep them.
 *
 * @param fields - The form's fields.
 * @returns The body.
 */
function updateBody(fields: ChannelFields) {
  const secret = fields.unsign ? { signingSecret: null } : {};
  return {
    name: fields.name,
    mentions: mentionsOf(fields.mentions),
    ...(fields.target ? { target: fields.target } : {}),
    ...(fields.signingSecret ? { signingSecret: fields.signingSecret } : secret),
  };
}

/**
 * Runs one intent.
 *
 * @param api - The API client.
 * @param intent - The intent.
 * @returns The outcome.
 */
async function run(api: ApiClient, intent: NotificationsIntent): Promise<NotificationsOutcome> {
  if (intent.intent === 'create') {
    const channel = await api.call(createChannelEndpoint, { body: createBody(intent.fields) });
    return { ok: true, channel };
  }
  const params = { channelId: intent.channelId };
  if (intent.intent === 'update') {
    const body = updateBody(intent.fields);
    return { ok: true, channel: await api.call(updateChannelEndpoint, { params, body }) };
  }
  if (intent.intent === 'test')
    return { ok: true, test: await api.call(testChannelEndpoint, { params }) };
  if (intent.intent === 'sends') {
    const { sends } = await api.call(listChannelSendsEndpoint, { params });
    return { ok: true, sends };
  }
  await api.call(deleteChannelEndpoint, { params });
  return { ok: true };
}

/**
 * The action of the notifications screen.
 *
 * @param api - The API client.
 * @returns The action. A refusal comes back as a message and the issues by field.
 */
export function changeNotifications(api: ApiClient) {
  return async ({ request }: ActionFunctionArgs): Promise<NotificationsOutcome> => {
    try {
      return await run(api, (await request.json()) as NotificationsIntent);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status >= 500) throw error;
      return { ok: false, message: error.message, issues: issuesByField(error.details) };
    }
  };
}
