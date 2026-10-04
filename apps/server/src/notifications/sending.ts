/**
 * Sends notifications to channels: each channel's recipe builds the request, the generic webhook
 * signs it, delivery retries it, and the log records it. Sending never throws to its caller.
 */
import {
  type ChannelEvent,
  type ChannelKind,
  channelKindSchema,
  type Notification,
  type PreviewInput,
  type ReportNotification,
  type SendResult,
  sampleMessage,
} from '@quanthea/shared';
import type { ChannelRow, SendRow } from '../db/channel-repository.ts';
import { newId } from '../lib/ids.ts';
import type { Logger } from '../lib/logger.ts';
import { openTarget, type StoreContext } from './channel-store.ts';
import { type Delivery, type DeliveryOptions, deliver } from './delivery.ts';
import type { RecipeChannel, RecipeRequest } from './recipe.ts';
import { channelRecipes, reportRecipes } from './registry.ts';
import { signatureHeaders } from './signature.ts';

/** What sending needs, besides the store. */
export interface SendContext extends StoreContext {
  /** How messages are posted. */
  readonly delivery: DeliveryOptions;
  /** quanthea's public URL, for the test message's link, when configured. */
  readonly publicUrl: string | undefined;
  /** Where unexpected failures are reported. */
  readonly logger: Logger | undefined;
}

/** A message on its way: what it is about, for the log, and how each kind builds it. */
export interface Outbound {
  /** What it reports. */
  readonly event: ChannelEvent;
  /** The alert it is about; empty for a report. */
  readonly alertId: string;
  /** The report it is about; `null` for an alert. */
  readonly reportId: string | null;
  /** The alert's series, or the report's run. */
  readonly seriesKey: string;
  /**
   * Builds the request for a kind of channel.
   *
   * @param kind - The channel's kind.
   * @param channel - The channel's target and mentions.
   * @returns The URL and the body.
   */
  readonly request: (kind: ChannelKind, channel: RecipeChannel) => RecipeRequest;
}

/**
 * An alert notification on its way.
 *
 * @param notification - The notification.
 * @returns The message.
 */
export function alertOutbound(notification: Notification): Outbound {
  const { event, alert, series } = notification;
  return {
    event,
    alertId: alert.id,
    reportId: null,
    seriesKey: series.key,
    request: (kind, channel) => channelRecipes[kind].build(notification, channel),
  };
}

/**
 * A report notification on its way. Its series key is its run, empty for a test.
 *
 * @param notification - The notification.
 * @returns The message.
 */
export function reportOutbound(notification: ReportNotification): Outbound {
  return {
    event: notification.event,
    alertId: '',
    reportId: notification.report.id,
    seriesKey: notification.run.id ?? '',
    request: (kind, channel) => reportRecipes[kind].build(notification, channel),
  };
}

/** The test message's title: the sample's, marked as a test. */
const testTemplate = {
  ...sampleMessage.template,
  title: 'Test from quanthea: {alert} is {value}',
  fields: [...sampleMessage.template.fields],
};

/**
 * Serializes a request and adds its headers: the generic webhook's signature when it has a secret.
 *
 * @param row - The channel.
 * @param body - The JSON body.
 * @param signingSecret - The channel's signing secret, if any.
 * @param context - The event and the clock.
 * @returns The headers and the serialized body.
 */
async function headersFor(
  row: ChannelRow,
  body: string,
  signingSecret: string | undefined,
  context: { readonly event: string; readonly deliveryId: string; readonly now: number },
): Promise<Record<string, string>> {
  const headers = { 'Content-Type': 'application/json', 'User-Agent': 'quanthea' };
  if (row.kind !== 'webhook') return headers;
  const identity = { 'X-Quanthea-Event': context.event, 'X-Quanthea-Delivery': context.deliveryId };
  const signature = signingSecret ? await signatureHeaders(signingSecret, body, context.now) : {};
  return { ...headers, ...identity, ...signature };
}

/**
 * Builds and posts one channel's message.
 *
 * @param context - Sending.
 * @param row - The channel.
 * @param message - The message.
 * @param deliveryId - The id the log and the webhook's header carry.
 * @returns How it went.
 */
async function post(
  context: SendContext,
  row: ChannelRow,
  message: Outbound,
  deliveryId: string,
): Promise<Delivery> {
  const { target, signingSecret } = await openTarget(context.secretBox, row);
  const kind = channelKindSchema.parse(row.kind);
  const request = message.request(kind, { target, mentions: row.mentions });
  const body = JSON.stringify(request.body);
  const meta = { event: message.event, deliveryId, now: context.now() };
  const headers = await headersFor(row, body, signingSecret, meta);
  const delivery = await deliver({ url: request.url, headers, body }, context.delivery);
  // A service may echo the URL back; the log never holds it.
  const error = delivery.error?.replaceAll(target, row.targetHint) ?? null;
  return { ...delivery, error };
}

/**
 * Logs a send. A failure to log is reported, never thrown.
 *
 * @param context - Sending.
 * @param send - The send, with how it went.
 */
function logSend(context: SendContext, send: SendRow): void {
  try {
    context.repository.recordSend(send);
  } catch (error) {
    const fields = { channelId: send.channelId, error: String(error) };
    context.logger?.error('a notification send was not logged', fields);
  }
}

/**
 * Sends to one channel and logs the send. It never throws.
 *
 * @param context - Sending.
 * @param channelId - The channel.
 * @param message - The message.
 * @returns The channel's result.
 */
async function sendOne(
  context: SendContext,
  channelId: string,
  message: Outbound,
): Promise<SendResult> {
  const row = context.repository.get(channelId);
  const unknown = 'There is no such channel.';
  if (!row) return { channelId, ok: false, httpStatus: null, attempts: 0, error: unknown };
  const id = newId();
  const delivery = await post(context, row, message, id).catch((error: unknown) => {
    context.logger?.error('a notification could not be built', { channelId, error: String(error) });
    return { ok: false, httpStatus: null, attempts: 0, error: 'The message could not be built.' };
  });
  const { event, alertId, reportId, seriesKey } = message;
  const at = context.now();
  logSend(context, { id, channelId, event, alertId, reportId, seriesKey, at, ...delivery });
  return { channelId, ...delivery };
}

/**
 * Sends a message to channels, all at once. It never throws.
 *
 * @param context - Sending.
 * @param channelIds - The channels.
 * @param message - The message.
 * @returns Each channel's result, in the order given.
 */
export function sendToChannels(
  context: SendContext,
  channelIds: readonly string[],
  message: Outbound,
): Promise<SendResult[]> {
  return Promise.all([...new Set(channelIds)].map((id) => sendOne(context, id, message)));
}

/**
 * The test notification: the sample message, marked as a test.
 *
 * @param publicUrl - quanthea's public URL, when configured, for the link.
 * @param now - The time, in epoch milliseconds.
 * @returns The notification.
 */
export function testNotification(publicUrl: string | undefined, now: number): Notification {
  const url = `${publicUrl?.replace(/\/$/, '') ?? ''}/settings/notifications`;
  const { alert, values, labels } = sampleMessage;
  return {
    event: 'alert.test',
    alert: { id: 'test', title: alert.title, version: 1, severity: 'info', url },
    series: { key: values.series, labels: { ...labels } },
    template: testTemplate,
    values: { ...values, link: url },
    at: new Date(now).toISOString(),
  };
}

/**
 * What each kind would send for a template. The targets are stand-ins; nothing is sent.
 *
 * @param input - The template, values, alert and labels.
 * @param now - The time, in epoch milliseconds.
 * @returns Each kind asked for, with its body.
 */
export function previewBodies(
  input: PreviewInput,
  now: number,
): { kind: ChannelKind; body: unknown }[] {
  const kinds = input.kind ? [input.kind] : channelKindSchema.options;
  const series = Object.entries(input.labels).map(([name, value]) => `${name}=${value}`);
  const notification: Notification = {
    event: input.event,
    alert: { id: 'preview', version: 1, url: input.values.link ?? '/alerts', ...input.alert },
    series: { key: series.join(','), labels: input.labels },
    template: input.template,
    values: input.values,
    at: new Date(now).toISOString(),
  };
  return kinds.map((kind) => {
    const target = kind === 'pagerduty' ? '<routing key>' : 'https://example.invalid/hook';
    return { kind, body: channelRecipes[kind].build(notification, { target, mentions: [] }).body };
  });
}
