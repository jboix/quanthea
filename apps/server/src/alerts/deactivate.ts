/**
 * Deactivating an alert: evaluation stops, and its series end. A series that announced firing
 * announces that it resolved, when the version asks for it and the alert is not muted, so a
 * channel such as PagerDuty closes its incident. Each series that was not ok records its change
 * to ok in the timeline. An alert in error leaves it: when it announced `alert.error`, it
 * announces `alert.recovered`, unless muted or the setting is off, so that incident closes too.
 */
import { type AlertSpec, alertSpecSchema } from '@quanthea/shared';
import { checkable } from '../db/alert-checks.ts';
import type { AlertRow } from '../db/alert-repository.ts';
import type { SeriesRow } from '../db/alert-state-repository.ts';
import { newId } from '../lib/ids.ts';
import { type AlertsContext, alertOrThrow } from './changes.ts';
import { checkNotification } from './check-notice.ts';
import { isMuted } from './evaluate.ts';
import { buildNotification } from './notify.ts';

/**
 * The spec of an alert's active version, if it has one that parses.
 *
 * @param context - The service context.
 * @param alert - The alert.
 * @returns The spec, or `undefined`.
 */
function activeSpec(context: AlertsContext, alert: AlertRow): AlertSpec | undefined {
  if (alert.activeVersion === null) return undefined;
  const row = context.repository.version(alert.id, alert.activeVersion);
  const parsed = alertSpecSchema.safeParse(row?.spec);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Sends the resolved notifications of the series that announced firing.
 *
 * @param context - The service context, with the sender and the link.
 * @param alert - The alert.
 * @param spec - Its active spec.
 * @param resolving - The series that announced firing.
 */
async function announceResolved(
  context: AlertsContext,
  alert: AlertRow,
  spec: AlertSpec,
  resolving: readonly SeriesRow[],
): Promise<void> {
  const now = context.now();
  const version = alert.activeVersion ?? 0;
  const url = context.alertUrl(alert.id);
  await Promise.allSettled(
    resolving.map((series) => {
      const about = { alertId: alert.id, version, spec, series, url };
      return context.notify(spec.channels, buildNotification(about, 'alert.resolved', now));
    }),
  );
}

/**
 * What deactivating does to an alert in error: it leaves error, records it, and announces it when
 * it had announced the error and messages are not held back.
 *
 * @param context - The service context, with the state store and the settings.
 * @param alert - The alert.
 * @param quiet - Whether messages are held back: the alert is muted.
 * @param now - When.
 * @returns The check to save, and whether to announce the recovery.
 */
function leaveError(context: AlertsContext, alert: AlertRow, quiet: boolean, now: number) {
  const previous = context.states.checkState(alert.id);
  if (previous.errorSince === null) return { check: undefined, announce: false };
  const announce = previous.notified && !quiet && context.settings.get().notifyOnError;
  const event = { id: newId(), kind: 'recovered' as const, at: now, reason: null };
  return { check: { state: checkable, event: { ...event, notified: announce } }, announce };
}

/**
 * Sends `alert.recovered` for an alert that leaves error. A failing sender is ignored, as for the
 * resolved notifications.
 *
 * @param context - The service context, with the sender and the link.
 * @param alert - The alert.
 * @param spec - Its active spec.
 * @param now - When.
 */
async function announceRecovered(
  context: AlertsContext,
  alert: AlertRow,
  spec: AlertSpec,
  now: number,
): Promise<void> {
  const about = {
    alertId: alert.id,
    version: alert.activeVersion ?? 0,
    spec,
    url: context.alertUrl(alert.id),
  };
  const notification = checkNotification(about, 'alert.recovered', null, now);
  await Promise.allSettled([context.notify(spec.channels, notification)]);
}

/**
 * The changes to ok of the series that were not ok, for the timeline.
 *
 * @param alert - The alert.
 * @param series - Its series.
 * @param resolving - The series that announce resolving.
 * @param now - When.
 * @returns The changes of state.
 */
function endingEvents(
  alert: AlertRow,
  series: readonly SeriesRow[],
  resolving: readonly SeriesRow[],
  now: number,
) {
  return series
    .filter((each) => each.state !== 'ok')
    .map((each) => ({
      id: newId(),
      version: alert.activeVersion ?? 0,
      seriesKey: each.key,
      labels: each.labels,
      from: each.state,
      to: 'ok' as const,
      at: now,
      value: each.value,
      message: null,
      notified: resolving.includes(each),
    }));
}

/**
 * Stops evaluating an alert and ends its series.
 *
 * @param context - The service context.
 * @param id - The alert.
 * @param actor - Who deactivates.
 * @throws {AppError} `not_found`.
 */
export async function deactivate(context: AlertsContext, id: string, actor: string): Promise<void> {
  const alert = alertOrThrow(context, id);
  const now = context.now();
  const spec = activeSpec(context, alert);
  const series = context.states.series(id);
  const muted = isMuted(alert, now);
  const resolving =
    spec?.notify.onResolved === true && !muted ? series.filter((each) => each.announced) : [];
  const events = endingEvents(alert, series, resolving, now);
  const { check, announce } = leaveError(context, alert, muted, now);
  context.repository.deactivate(id, now);
  const removed = series.map((each) => each.key);
  const evaluatedAt = alert.evaluatedAt ?? now;
  context.states.saveEvaluation(id, { evaluatedAt, series: [], removed, events, check });
  context.audit.append({ actor, action: 'alert.deactivate', target: id });
  if (spec && resolving.length > 0) await announceResolved(context, alert, spec, resolving);
  if (spec && announce) await announceRecovered(context, alert, spec, now);
}
