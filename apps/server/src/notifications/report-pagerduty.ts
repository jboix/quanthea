/**
 * PagerDuty and reports. A report is not an incident, so a ready run pages no one: it resolves the
 * report's failure incident, if there is one, and PagerDuty ignores a resolve for an incident it
 * does not have. A run that failed after its retries triggers that incident, keyed
 * `<report id>/failed`, at warning severity, so the next good run closes it. A test is a change
 * event, which pages no one. PagerDuty shows text as it is, so nothing is escaped.
 */
import type { ReportNotification } from '@quanthea/shared';
import { pagerDutyChangesUrl, pagerDutyEventsUrl } from './pagerduty.ts';
import { type RecipeChannel, truncate } from './recipe.ts';
import { failureSentence, openableLinks, type ReportRecipe, reportTitle } from './report-recipe.ts';

/** The longest dedup key PagerDuty takes. */
const maxDedupKey = 255;

/**
 * Text as it is: PagerDuty escapes nothing.
 *
 * @param text - The text.
 * @returns The same text.
 */
const asIs = (text: string): string => text;

/**
 * The dedup key of a report's failure incident.
 *
 * @param notification - The notification.
 * @returns The key, the same for every run of the report.
 */
function dedupKeyOf(notification: ReportNotification): string {
  return `${notification.report.id}/failed`.slice(0, maxDedupKey);
}

/**
 * What an event carries besides its summary: the period, the reason and the numbers.
 *
 * @param notification - The notification.
 * @returns The custom details.
 */
function detailsOf(notification: ReportNotification) {
  const numbers = notification.lines.map((line) => {
    const text = line.change === null ? line.value : `${line.value} ${line.change}`;
    return [line.label, text] as const;
  });
  const reason = failureSentence(notification, asIs);
  const failure = reason === null ? {} : { reason };
  return { period: notification.run.period, ...failure, ...Object.fromEntries(numbers) };
}

/**
 * Builds the event: a change event for a test, a resolve when ready, a trigger when failed.
 *
 * @param notification - The notification.
 * @param channel - The channel, whose target is the routing key.
 * @returns The request.
 */
function build(notification: ReportNotification, channel: RecipeChannel) {
  const routing_key = channel.target;
  const summary = truncate(reportTitle(notification, asIs), 1024);
  const custom_details = detailsOf(notification);
  const links = openableLinks(notification).map((link) => ({ href: link.url, text: link.label }));
  const timestamp = notification.at;
  if (notification.test) {
    const payload = { summary, source: 'quanthea', timestamp, custom_details };
    return { url: pagerDutyChangesUrl, body: { routing_key, payload, links } };
  }
  const dedup_key = dedupKeyOf(notification);
  if (notification.event === 'report.ready')
    return { url: pagerDutyEventsUrl, body: { routing_key, event_action: 'resolve', dedup_key } };
  const payload = { summary, source: 'quanthea', severity: 'warning', timestamp, custom_details };
  const client = { client: 'quanthea', ...(links[0] ? { client_url: links[0].href } : {}) };
  const body = { routing_key, event_action: 'trigger', dedup_key, payload, ...client, links };
  return { url: pagerDutyEventsUrl, body };
}

/** PagerDuty's report recipe. */
export const pagerDutyReportRecipe: ReportRecipe = { kind: 'pagerduty', build };
