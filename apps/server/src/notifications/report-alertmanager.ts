/**
 * Alertmanager and reports. A report is not an alert, so a ready run fires nothing: it ends the
 * report's failure alert, if Alertmanager still holds one. A run that failed after its retries
 * fires that alert, at warning severity, with the labels `alertname` (the report's title) and
 * `quanthea_report` (the report id). It is said once and carries no end, so Alertmanager ends it
 * after its `resolve_timeout`. A test is marked `quanthea_test="true"` and ends by itself after
 * five minutes. Alertmanager shows text as it is, so nothing is escaped.
 */
import type { ReportNotification } from '@quanthea/shared';
import { after, alertsUrl, generatorOf, type PostableAlert } from './alertmanager.ts';
import type { RecipeChannel } from './recipe.ts';
import { failureSentence, lineValue, type ReportRecipe, reportTitle } from './report-recipe.ts';

/** How long a test alert lasts in Alertmanager, in milliseconds. */
const testLastsMs = 5 * 60_000;

/**
 * Text as it is: Alertmanager escapes nothing.
 *
 * @param text - The text.
 * @returns The same text.
 */
const asIs = (text: string): string => text;

/**
 * The labels of a report's alert, the same for every run of the report.
 *
 * @param notification - The notification.
 * @returns The labels.
 */
function labelsOf(notification: ReportNotification): Record<string, string> {
  const { id, title } = notification.report;
  const test = notification.test ? { quanthea_test: 'true' } : {};
  return { alertname: title, severity: 'warning', quanthea_report: id, ...test };
}

/**
 * The annotations: the title as `summary`, then why the run failed, or the period and the numbers.
 *
 * @param notification - The notification.
 * @returns The annotations.
 */
function annotationsOf(notification: ReportNotification): Record<string, string> {
  const numbers = notification.lines.map((line) => `${line.label}: ${lineValue(line, asIs)}`);
  const reason = failureSentence(notification, asIs);
  const description = [reason ?? notification.run.period, ...numbers].join('\n');
  return { summary: reportTitle(notification, asIs), description };
}

/**
 * When a report's alert starts and ends: a test lasts five minutes, a ready run ends the failure,
 * and a failure starts with no end.
 *
 * @param notification - The notification.
 * @returns The start, the end, or both.
 */
function timesOf(notification: ReportNotification): Pick<PostableAlert, 'startsAt' | 'endsAt'> {
  const { at } = notification;
  if (notification.test) return { startsAt: at, endsAt: after(at, testLastsMs) };
  return notification.event === 'report.ready' ? { endsAt: at } : { startsAt: at };
}

/**
 * Builds the request: one alert, firing for a failed run or a test, ended for a ready run.
 *
 * @param notification - The notification.
 * @param channel - The channel, whose target is Alertmanager's base URL.
 * @returns The request.
 */
function build(notification: ReportNotification, channel: RecipeChannel) {
  const alert: PostableAlert = {
    labels: labelsOf(notification),
    annotations: annotationsOf(notification),
    ...timesOf(notification),
    ...generatorOf(notification.link.url),
  };
  return { url: alertsUrl(channel.target), body: [alert] };
}

/** Alertmanager's report recipe. */
export const alertmanagerReportRecipe: ReportRecipe = { kind: 'alertmanager', build };
