/**
 * What every channel kind's report recipe shares. A report's message is quanthea's own: the title
 * with the period, the headline numbers with their change, the reason a run failed, a link to the
 * run and links to dashboards. Every text in it comes from the spec or the data, so each recipe
 * escapes all of it as values; only our own words are written as they are. Mentions come only
 * from the channel, on `report.failed`, as alerts add them only when something is wrong.
 */
import type { ChannelKind, ReportNotification } from '@quanthea/shared';
import { isAbsoluteLink, type RecipeChannel, type RecipeRequest, truncate } from './recipe.ts';

/** One channel kind's report recipe. */
export interface ReportRecipe {
  /** The kind it serves. */
  readonly kind: ChannelKind;
  /**
   * Builds the request for a report notification.
   *
   * @param notification - The notification, with its numbers and links.
   * @param channel - The channel's target and mentions.
   * @returns The URL and the body. Building never sends anything.
   */
  build(notification: ReportNotification, channel: RecipeChannel): RecipeRequest;
}

/** A link a message carries. */
type ReportLink = ReportNotification['link'];

/** Escapes a text for a service. */
type Escape = (value: string) => string;

/**
 * The colour of a report message: blue when ready, amber when failed, grey for a test.
 *
 * @param notification - The notification.
 * @returns The colour, as `#rrggbb`.
 */
export function reportColour(notification: ReportNotification): string {
  if (notification.test) return '#6b7280';
  return notification.event === 'report.ready' ? '#2a55c9' : '#e8a317';
}

/**
 * The state of a report message in words.
 *
 * @param notification - The notification.
 * @returns `Report ready`, `Report failed`, or the same marked as a test.
 */
function stateWords(notification: ReportNotification): string {
  const words = notification.event === 'report.ready' ? 'Report ready' : 'Report failed';
  return notification.test ? `Test · ${words}` : words;
}

/**
 * The context line under a message: the state, the period and the time.
 *
 * @param notification - The notification.
 * @param escapeValue - The service's value escaper, for the period's words.
 * @returns The line.
 */
export function reportContext(notification: ReportNotification, escapeValue: Escape): string {
  const period = escapeValue(truncate(notification.run.period, 200));
  return `quanthea · ${stateWords(notification)} · ${period} · ${notification.at}`;
}

/**
 * The message's title, marked when it is a test and when the run failed.
 *
 * @param notification - The notification.
 * @param escapeValue - The service's value escaper.
 * @returns The title.
 */
export function reportTitle(notification: ReportNotification, escapeValue: Escape): string {
  const title = escapeValue(truncate(notification.title, 250));
  const failed = notification.event === 'report.failed' ? ' failed' : '';
  return `${notification.test ? 'Test from quanthea: ' : ''}${title}${failed}`;
}

/**
 * Why a run failed, in a sentence; the period and the reason are escaped as values.
 *
 * @param notification - The notification.
 * @param escapeValue - The service's value escaper.
 * @returns The sentence, or `null` for a ready run.
 */
export function failureSentence(
  notification: ReportNotification,
  escapeValue: Escape,
): string | null {
  if (notification.event !== 'report.failed') return null;
  const reason = escapeValue(truncate(notification.reason ?? 'The queries failed.', 300));
  return `The run for ${escapeValue(notification.run.period)} failed after its retries: ${reason}`;
}

/**
 * A headline number's value and change as one text.
 *
 * @param line - The number with its label and change.
 * @param escapeValue - The service's value escaper.
 * @returns The value and its change, escaped.
 */
export function lineValue(line: ReportNotification['lines'][number], escapeValue: Escape): string {
  const value = escapeValue(truncate(line.value, 200) || '–');
  return line.change === null ? value : `${value}  ${escapeValue(line.change)}`;
}

/**
 * The links a service can open: the run, then the dashboards, those with an absolute URL only.
 *
 * @param notification - The notification.
 * @returns The links.
 */
export function openableLinks(notification: ReportNotification): ReportLink[] {
  return [notification.link, ...notification.seeAlso].filter((link) => isAbsoluteLink(link.url));
}

/**
 * The channel's mentions, on a failed run only, never on a test.
 *
 * @param notification - The notification.
 * @param channel - The channel.
 * @returns The mentions to add.
 */
export function reportMentions(notification: ReportNotification, channel: RecipeChannel): string[] {
  return notification.event === 'report.failed' && !notification.test ? [...channel.mentions] : [];
}
