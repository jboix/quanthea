/**
 * Prometheus Alertmanager: the v2 API, `POST /api/v2/alerts` with a JSON array of alerts.
 * Alertmanager tells alerts apart by their labels, so the labels are the same for every message of
 * one series of one alert: `alertname` (the alert's title), `severity`, `quanthea_alert` (the alert
 * id) and the series' labels. Its annotations carry the message. Alertmanager shows text as it is,
 * so nothing is escaped.
 *
 * Alertmanager ends an alert it is not told about again, so a firing alert says until when it holds
 * (`firing.until`, a few evaluations ahead) and the evaluator says it again at every evaluation
 * while it fires: a keep-alive, which no other kind of channel receives. A resolved alert carries
 * its end. An alert that cannot be checked is an alert of its own, marked
 * `quanthea_check="failed"`, kept alive the same way, which its recovery ends. A test is marked
 * `quanthea_test="true"` and ends by itself after five minutes.
 */
import type { Notification } from '@quanthea/shared';
import {
  type ChannelRecipe,
  type Escapers,
  fillMessage,
  isAbsoluteLink,
  type RecipeChannel,
} from './recipe.ts';

/** One alert as Alertmanager's v2 API takes it. */
export interface PostableAlert {
  /** What tells the alert apart from every other. */
  readonly labels: Readonly<Record<string, string>>;
  /** What it says. */
  readonly annotations: Readonly<Record<string, string>>;
  /** Since when it fires; Alertmanager keeps the earliest it was told. */
  readonly startsAt?: string;
  /** Until when it holds, or when it ended. Without one Alertmanager applies `resolve_timeout`. */
  readonly endsAt?: string;
  /** The link back to quanthea. */
  readonly generatorURL?: string;
}

/** How long a test alert lasts in Alertmanager, in milliseconds. */
const testLastsMs = 5 * 60_000;

/** Plain text: nothing to escape. */
const asIs: Escapers = { text: (words) => words, value: (value) => value };

/**
 * Where alerts are posted: the base URL, which may hold a route prefix, then `/api/v2/alerts`.
 *
 * @param base - The channel's base URL.
 * @returns The URL of the v2 alerts endpoint.
 */
export function alertsUrl(base: string): string {
  const url = new URL(base);
  const prefix = url.pathname.replace(/\/+$/, '').replace(/\/api\/v2\/alerts$/, '');
  url.pathname = `${prefix}/api/v2/alerts`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

/**
 * A label name Prometheus accepts: letters, digits and underscores, not starting with a digit.
 * Every other character becomes an underscore.
 *
 * @param name - The name as the data gave it.
 * @returns The valid name.
 */
export function labelName(name: string): string {
  const valid = name.replace(/[^a-zA-Z0-9_]/g, '_');
  return /^[a-zA-Z_]/.test(valid) ? valid : `_${valid}`;
}

/**
 * Whether a label name is quanthea's to set: `alertname`, `severity`, and all of `quanthea_`.
 *
 * @param name - The valid name.
 * @returns `true` when a series label may not take it.
 */
function isReserved(name: string): boolean {
  return name === 'alertname' || name === 'severity' || name.startsWith('quanthea_');
}

/**
 * The name a series label takes: its own, with `series_` before a reserved one, then `_2`, `_3`
 * and so on when another label already took it.
 *
 * @param taken - The labels so far.
 * @param name - The valid name.
 * @returns A name no label has yet.
 */
function freeName(taken: ReadonlyMap<string, string>, name: string): string {
  const base = isReserved(name) ? `series_${name}` : name;
  if (!taken.has(base)) return base;
  for (let count = 2; ; count += 1) {
    const numbered = `${base}_${count}`;
    if (!taken.has(numbered)) return numbered;
  }
}

/**
 * The labels of an alert: quanthea's own, then the series' labels in the order of their names, so
 * a clash always resolves the same way. A label without a value is left out, as Alertmanager
 * drops it.
 *
 * @param own - The labels quanthea sets.
 * @param series - The series' labels, as the data gave them.
 * @returns The labels, every name valid and none twice.
 */
export function alertLabels(
  own: Readonly<Record<string, string>>,
  series: Readonly<Record<string, string>>,
): Record<string, string> {
  const labels = new Map(Object.entries(own));
  for (const name of Object.keys(series).sort()) {
    const value = series[name];
    if (value) labels.set(freeName(labels, labelName(name)), value);
  }
  return Object.fromEntries(labels);
}

/**
 * The labels of a notification: the alert's, the mark of a test or of a failed check, and the
 * series' labels. A check is about the alert as a whole, so it carries no series label.
 *
 * @param notification - The notification.
 * @returns The labels, the same for every message about the same thing.
 */
function labelsOf(notification: Notification): Record<string, string> {
  const { alert, event, series } = notification;
  const own = { alertname: alert.title, severity: alert.severity, quanthea_alert: alert.id };
  if (event === 'alert.error' || event === 'alert.recovered')
    return { ...own, quanthea_check: 'failed' };
  const test = event === 'alert.test' ? { quanthea_test: 'true' } : {};
  return alertLabels({ ...own, ...test }, series.labels);
}

/**
 * The annotations: the title as `summary`, the body and the fields as `description`, the value.
 *
 * @param notification - The notification.
 * @returns The annotations.
 */
function annotationsOf(notification: Notification): Record<string, string> {
  const message = fillMessage(notification.template, notification.values, asIs);
  const fields = message.fields.map((field) => `${field.label}: ${field.value}`);
  const description = [message.body, ...fields].join('\n');
  const { value } = notification.values;
  return { summary: message.title, description, ...(value ? { value } : {}) };
}

/**
 * An instant some time after another.
 *
 * @param at - The instant, as an ISO date and time.
 * @param ms - How long after, in milliseconds.
 * @returns The later instant, as an ISO date and time.
 */
export function after(at: string, ms: number): string {
  return new Date(Date.parse(at) + ms).toISOString();
}

/**
 * When a notification's alert starts and ends. A firing holds until the instant it names; one
 * that names none carries no end, and Alertmanager applies its `resolve_timeout`.
 *
 * @param notification - The notification.
 * @returns The start, the end, or both.
 */
function timesOf(notification: Notification): Pick<PostableAlert, 'startsAt' | 'endsAt'> {
  const { event, at, firing } = notification;
  if (event === 'alert.resolved' || event === 'alert.recovered') return { endsAt: at };
  if (event === 'alert.test') return { startsAt: at, endsAt: after(at, testLastsMs) };
  const startsAt = firing?.since ?? at;
  return firing?.until === undefined ? { startsAt } : { startsAt, endsAt: firing.until };
}

/**
 * The link back, when Alertmanager can open it: an absolute URL.
 *
 * @param url - The link.
 * @returns The `generatorURL`, or nothing.
 */
export function generatorOf(url: string): Pick<PostableAlert, 'generatorURL'> {
  return isAbsoluteLink(url) ? { generatorURL: url } : {};
}

/**
 * Builds the request: one alert, firing or ended.
 *
 * @param notification - The notification.
 * @param channel - The channel, whose target is Alertmanager's base URL.
 * @returns The request.
 */
function build(notification: Notification, channel: RecipeChannel) {
  const alert: PostableAlert = {
    labels: labelsOf(notification),
    annotations: annotationsOf(notification),
    ...timesOf(notification),
    ...generatorOf(notification.alert.url),
  };
  return { url: alertsUrl(channel.target), body: [alert] };
}

/** The Alertmanager recipe. */
export const alertmanagerRecipe: ChannelRecipe = { kind: 'alertmanager', build };
