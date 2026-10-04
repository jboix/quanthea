/**
 * Sends a version's message to its channels as a test (`alert.test`), so a person sees what each
 * service shows before activating it. The values come from one series, such as a firing from the
 * replay, filled as the evaluator fills them.
 */
import {
  alertSpecSchema,
  type Notification,
  type NotifiedSeries,
  notificationValues,
} from '@quanthea/shared';
import { AppError } from '../lib/errors.ts';
import { type AlertsContext, alertOrThrow } from './changes.ts';
import { seriesKeyOf } from './series.ts';

/**
 * Builds the test notification of a version.
 *
 * @param context - The service context.
 * @param id - The alert.
 * @param version - The version.
 * @param series - The series; a stand-in without labels or value when left out.
 * @returns The channels and the notification.
 * @throws {AppError} `not_found` for an unknown version, `bad_request` when it notifies no one.
 */
function testNotification(
  context: AlertsContext,
  id: string,
  version: number,
  series: NotifiedSeries | undefined,
): { channels: string[]; notification: Notification } {
  alertOrThrow(context, id);
  const row = context.repository.version(id, version);
  if (!row) throw new AppError('not_found', `Alert ${id} has no version ${version}.`);
  const spec = alertSpecSchema.parse(row.spec);
  if (spec.channels.length === 0)
    throw new AppError('bad_request', 'This version notifies no channel. Add one first.');
  const now = context.now();
  const subject = series ?? { labels: {}, value: null, since: now };
  const url = context.alertUrl(id);
  const { title, severity } = spec;
  const notification: Notification = {
    event: 'alert.test',
    alert: { id, title, version, severity, url },
    series: { key: seriesKeyOf(subject.labels), labels: { ...subject.labels } },
    template: spec.message,
    values: notificationValues(spec, subject, url),
    at: new Date(now).toISOString(),
  };
  return { channels: spec.channels, notification };
}

/**
 * Sends a version's message to its channels as a test.
 *
 * @param context - The service context.
 * @param id - The alert.
 * @param version - The version.
 * @param series - The series the message is about, if any.
 * @param actor - Who sends it.
 * @returns Each channel's result, as the channels report it.
 */
export async function sendTest(
  context: AlertsContext,
  id: string,
  version: number,
  series: NotifiedSeries | undefined,
  actor: string,
): Promise<unknown> {
  const { channels, notification } = testNotification(context, id, version, series);
  context.audit.append({ actor, action: 'alert.test', target: id, detail: { version } });
  return context.notify(channels, notification);
}
