/**
 * The notifications service: the channels admins keep, sending to them, and previews. Alerts call
 * `send` with the channels they picked; it never throws, and returns each channel's result.
 */
import type {
  ChannelInput,
  ChannelKind,
  ChannelPatch,
  ChannelSend,
  Notification,
  PreviewInput,
  ReportNotification,
  SendResult,
} from '@quanthea/shared';
import type { AuditRepository } from '../db/audit-repository.ts';
import type { ChannelRepository } from '../db/channel-repository.ts';
import type { Logger } from '../lib/logger.ts';
import type { SecretBox } from '../secrets/secret-box.ts';
import {
  type ChannelInfo,
  channelRow,
  createChannel,
  removeChannel,
  type StoreContext,
  toInfo,
  updateChannel,
} from './channel-store.ts';
import { type DeliveryOptions, resolveHost } from './delivery.ts';
import {
  alertOutbound,
  previewBodies,
  reportOutbound,
  type SendContext,
  sendToChannels,
  testNotification,
} from './sending.ts';

/** What the notifications service needs. */
export interface NotificationsDependencies {
  /** Stores channels and their log. */
  readonly repository: ChannelRepository;
  /** Seals targets. */
  readonly secretBox: SecretBox;
  /** Records who changed what. */
  readonly audit: AuditRepository;
  /** How many alerts send to a channel; none until alerts say otherwise. */
  readonly alertsUsing?: (channelId: string) => number;
  /** How many reports send to a channel; none until reports say otherwise. */
  readonly reportsUsing?: (channelId: string) => number;
  /** How messages are posted; the platform's `fetch`, timers and resolver by default. */
  readonly delivery?: Partial<DeliveryOptions>;
  /** quanthea's public URL, for the test message's link. */
  readonly publicUrl?: string | undefined;
  /** Where unexpected failures are reported. */
  readonly logger?: Logger;
  /** The clock, in epoch milliseconds. */
  readonly now?: () => number;
}

/** The notifications service. Methods taking an id throw `AppError` `not_found` for an unknown one. */
export interface Notifications {
  /**
   * Lists the channels.
   *
   * @returns Every channel, by name, the target masked.
   */
  list(): ChannelInfo[];
  /**
   * Lists the channels for picking one.
   *
   * @returns Each channel's id, name and kind.
   */
  picker(): { id: string; name: string; kind: ChannelKind }[];
  /**
   * Adds a channel.
   *
   * @param input - The validated channel.
   * @param actor - Who adds it.
   * @returns The channel.
   */
  create(input: ChannelInput, actor: string): Promise<ChannelInfo>;
  /**
   * Changes a channel.
   *
   * @param id - The channel id.
   * @param patch - The change.
   * @param actor - Who changes it.
   * @returns The channel.
   */
  update(id: string, patch: ChannelPatch, actor: string): Promise<ChannelInfo>;
  /**
   * Deletes a channel no alert sends to.
   *
   * @param id - The channel id.
   * @param actor - Who deletes it.
   */
  remove(id: string, actor: string): void;
  /**
   * Sends a notification to channels, logging each send. It never throws.
   *
   * @param channelIds - The channels.
   * @param notification - The notification.
   * @returns Each channel's result; an unknown channel's is a failure.
   */
  send(channelIds: readonly string[], notification: Notification): Promise<SendResult[]>;
  /**
   * Sends a report notification to channels, logging each send. It never throws.
   *
   * @param channelIds - The channels.
   * @param notification - The notification.
   * @returns Each channel's result; an unknown channel's is a failure.
   */
  sendReport(
    channelIds: readonly string[],
    notification: ReportNotification,
  ): Promise<SendResult[]>;
  /**
   * Sends the test message to a channel.
   *
   * @param id - The channel id.
   * @param actor - Who asks.
   * @returns How it went.
   */
  test(id: string, actor: string): Promise<SendResult>;
  /**
   * Lists a channel's recent sends.
   *
   * @param id - The channel id.
   * @returns The newest first.
   */
  sends(id: string): ChannelSend[];
  /**
   * What each kind would send for a template. Nothing is sent.
   *
   * @param input - The template, values, alert and labels.
   * @returns Each kind's body.
   */
  preview(input: PreviewInput): { kind: ChannelKind; body: unknown }[];
  /**
   * Deletes old sends: older than the log keeps, or beyond each channel's newest.
   *
   * @returns How many were deleted.
   */
  purgeSends(): number;
}

/** How long the log keeps a send, in milliseconds: 30 days. */
const logKeepsMs = 30 * 86_400_000;

/** How many of each channel's newest sends the log keeps. */
const logKeepsPerChannel = 200;

/** How many sends a channel's log lists. */
const sendsListed = 50;

/**
 * Waits.
 *
 * @param ms - How long, in milliseconds.
 * @returns Once the time is up.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fills in what was not given: the platform's `fetch`, timers and resolver, the clock.
 *
 * @param dependencies - The dependencies.
 * @returns The context the store and sending share.
 */
function contextOf(dependencies: NotificationsDependencies): SendContext {
  const delivery: DeliveryOptions = {
    fetch: (url, init) => fetch(url, init),
    sleep,
    resolve: resolveHost,
    timeoutMs: 10_000,
    ...dependencies.delivery,
  };
  return {
    ...dependencies,
    alertsUsing: dependencies.alertsUsing ?? (() => 0),
    reportsUsing: dependencies.reportsUsing ?? (() => 0),
    resolve: delivery.resolve,
    now: dependencies.now ?? Date.now,
    delivery,
    publicUrl: dependencies.publicUrl,
    logger: dependencies.logger,
  };
}

/**
 * The methods that read and change channels.
 *
 * @param context - The store.
 * @returns Them.
 */
function channelMethods(
  context: StoreContext,
): Pick<Notifications, 'list' | 'picker' | 'create' | 'update' | 'remove' | 'sends'> {
  const { repository, alertsUsing } = context;
  return {
    list: () => repository.list().map((row) => toInfo(row, alertsUsing)),
    picker: () =>
      repository
        .list()
        .map((row) => toInfo(row, alertsUsing))
        .map(({ id, name, kind }) => ({ id, name, kind })),
    create: (input, actor) => createChannel(context, input, actor),
    update: (id, patch, actor) => updateChannel(context, id, patch, actor),
    remove: (id, actor) => removeChannel(context, id, actor),
    sends: (id) => {
      channelRow(context, id);
      return repository.sends(id, sendsListed).map(({ channelId: _channel, ...send }) => send);
    },
  };
}

/**
 * Creates the notifications service.
 *
 * @param dependencies - The repository, the secret box, the audit log and how to post.
 * @returns The service.
 */
export function createNotifications(dependencies: NotificationsDependencies): Notifications {
  const context = contextOf(dependencies);
  return {
    ...channelMethods(context),
    send: (channelIds, notification) =>
      sendToChannels(context, channelIds, alertOutbound(notification)),
    sendReport: (channelIds, notification) =>
      sendToChannels(context, channelIds, reportOutbound(notification)),
    test: async (id, actor) => {
      channelRow(context, id);
      context.audit.append({ actor, action: 'channel.test', target: id });
      const test = alertOutbound(testNotification(context.publicUrl, context.now()));
      const [result] = await sendToChannels(context, [id], test);
      return result as SendResult;
    },
    preview: (input) => previewBodies(input, context.now()),
    purgeSends: () => context.repository.purgeSends(context.now() - logKeepsMs, logKeepsPerChannel),
  };
}
