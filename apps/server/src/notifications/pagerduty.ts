/**
 * PagerDuty: the Events API v2. Firing triggers an incident and resolving resolves it, matched by
 * a dedup key made of the alert id and the series key. An alert that cannot be checked triggers an
 * incident of its own, keyed `<alert id>/error`, which its recovery resolves. A test sends a change
 * event, which shows on the service without paging anyone. PagerDuty shows text as it is, so
 * nothing is escaped.
 */
import type { Notification } from '@quanthea/shared';
import {
  type ChannelRecipe,
  type Escapers,
  fillMessage,
  isAbsoluteLink,
  type RecipeChannel,
  truncate,
} from './recipe.ts';

/** Where alert events go. */
export const pagerDutyEventsUrl = 'https://events.pagerduty.com/v2/enqueue';

/** Where change events go. */
export const pagerDutyChangesUrl = 'https://events.pagerduty.com/v2/change/enqueue';

/** The longest dedup key PagerDuty takes. */
const maxDedupKey = 255;

/** Plain text: nothing to escape. */
const asIs: Escapers = { text: (words) => words, value: (value) => value };

/**
 * The dedup key of an alert's series: the alert id and the series key, or, when that is too long,
 * the alert id and the series key's SHA-256. Whether the alert can be checked has its own key, the
 * alert id and `error`.
 *
 * @param notification - The notification.
 * @returns The key, the same for every event of one series of one alert.
 */
export function dedupKeyOf(notification: Notification): string {
  const { event } = notification;
  if (event === 'alert.error' || event === 'alert.recovered')
    return `${notification.alert.id}/error`.slice(0, maxDedupKey);
  const key = `${notification.alert.id}/${notification.series.key}`;
  if (key.length <= maxDedupKey) return key;
  const digest = new Bun.CryptoHasher('sha256').update(notification.series.key).digest('hex');
  return `${notification.alert.id}/sha256:${digest}`.slice(0, maxDedupKey);
}

/**
 * What the event carries besides its summary: the body, the fields and the series' labels.
 *
 * @param notification - The notification.
 * @returns The summary and the custom details.
 */
function detailsOf(notification: Notification) {
  const message = fillMessage(notification.template, notification.values, asIs);
  const fields = Object.fromEntries(message.fields.map((field) => [field.label, field.value]));
  return {
    summary: truncate(message.title, 1024),
    custom_details: { body: message.body, ...fields, labels: notification.series.labels },
  };
}

/**
 * The links an event carries: the alert in quanthea, when its link is absolute.
 *
 * @param notification - The notification.
 * @returns The links.
 */
function linksOf(notification: Notification) {
  const { url } = notification.alert;
  return isAbsoluteLink(url) ? [{ href: url, text: 'Open in quanthea' }] : [];
}

/**
 * Builds the event: a change event for a test, a resolve when resolved or checked again, or a
 * trigger when firing or when the alert cannot be checked.
 *
 * @param notification - The notification.
 * @param channel - The channel, whose target is the routing key.
 * @returns The request.
 */
function build(notification: Notification, channel: RecipeChannel) {
  const routing_key = channel.target;
  const { summary, custom_details } = detailsOf(notification);
  const timestamp = notification.at;
  const links = linksOf(notification);
  if (notification.event === 'alert.test') {
    const payload = { summary, source: 'quanthea', timestamp, custom_details };
    return { url: pagerDutyChangesUrl, body: { routing_key, payload, links } };
  }
  const dedup_key = dedupKeyOf(notification);
  if (notification.event === 'alert.resolved' || notification.event === 'alert.recovered')
    return { url: pagerDutyEventsUrl, body: { routing_key, event_action: 'resolve', dedup_key } };
  const { severity } = notification.alert;
  const payload = { summary, source: 'quanthea', severity, timestamp, custom_details };
  const client = { client: 'quanthea', ...(links[0] ? { client_url: links[0].href } : {}) };
  const body = { routing_key, event_action: 'trigger', dedup_key, payload, ...client, links };
  return { url: pagerDutyEventsUrl, body };
}

/** The PagerDuty recipe. */
export const pagerDutyRecipe: ChannelRecipe = { kind: 'pagerduty', build };
