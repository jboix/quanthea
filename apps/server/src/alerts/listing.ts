/**
 * What the alert pages show beyond the stored alert: the series that stands for it, its condition,
 * the latest message sent about it, the channels it names and what people did to it. People are
 * named by user id here; the routes replace the ids with names.
 */
import {
  type AlertDetail,
  type AlertListItem,
  type AlertSpec,
  type AlertState,
  type AlertSummary,
  alertActions,
} from '@quanthea/shared';
import type { AlertActivityRepository, AlertChange, AlertSend } from '../db/alert-activity.ts';
import type { SeriesRow } from '../db/alert-state-repository.ts';

/** How many messages sent about an alert its page lists. */
const recentSends = 20;

/** How many changes people made its page lists. */
const recentChanges = 50;

/** How bad each state is, the worst first. */
const stateRank: Readonly<Record<AlertState, number>> = {
  firing: 0,
  pending: 1,
  error: 2,
  no_data: 3,
  ok: 4,
};

/** Reads nothing, for a service built without the activity store. */
export const noActivity: AlertActivityRepository = {
  channels: () => [],
  sends: () => [],
  lastSends: () => new Map(),
  changes: () => [],
};

/**
 * How far a value is past the threshold's side: higher is worse.
 *
 * @param value - The value, or `null`.
 * @param spec - The spec, for the condition's direction.
 * @returns The badness; a missing value is the least bad.
 */
function badness(value: number | null, spec: AlertSpec): number {
  if (value === null) return Number.NEGATIVE_INFINITY;
  const below = spec.condition.kind === 'threshold' && spec.condition.op === 'below';
  return below ? -value : value;
}

/**
 * The series that stands for an alert: the worst state, then the value furthest past the
 * threshold.
 *
 * @param series - The series as the last evaluation left them.
 * @param spec - The spec of the version shown.
 * @returns The series, or `null` when there is none.
 */
export function leadSeries(series: readonly SeriesRow[], spec: AlertSpec): AlertListItem['lead'] {
  const sorted = [...series].sort(
    (a, b) =>
      stateRank[a.state] - stateRank[b.state] || badness(b.value, spec) - badness(a.value, spec),
  );
  const [lead] = sorted;
  if (!lead) return null;
  return { labels: { ...lead.labels }, state: lead.state, since: lead.since, value: lead.value };
}

/**
 * An alert as the list shows it.
 *
 * @param summary - Its summary.
 * @param spec - The spec of the version shown.
 * @param series - Its series.
 * @param lastSend - The latest message sent about it, if any.
 * @returns The list item.
 */
export function toListItem(
  summary: AlertSummary,
  spec: AlertSpec,
  series: readonly SeriesRow[],
  lastSend: AlertSend | undefined,
): AlertListItem {
  return {
    ...summary,
    condition: { ...spec.condition },
    format: spec.value.format ?? null,
    lead: leadSeries(series, spec),
    seriesCount: series.length,
    lastNotification: lastSend
      ? { channel: lastSend.channel, at: lastSend.at, ok: lastSend.ok }
      : null,
  };
}

/**
 * Something someone did, as the API shows it.
 *
 * @param change - The audit entry.
 * @returns The activity, or nothing for an action the timeline does not show.
 */
function activityOf(change: AlertChange): AlertDetail['activity'] {
  const action = alertActions.find((each) => `alert.${each}` === change.action);
  if (!action) return [];
  const detail = (change.detail ?? {}) as { version?: unknown; until?: unknown };
  const version = typeof detail.version === 'number' ? detail.version : null;
  const until = typeof detail.until === 'number' ? detail.until : null;
  return [{ action, at: change.at, by: change.actor, version, until }];
}

/**
 * What an alert's page shows besides its stored state: its channels, the latest messages sent
 * about it and what people did to it.
 *
 * @param activity - The activity store.
 * @param alertId - The alert.
 * @param spec - The spec of the version shown.
 * @returns The channels, the sends and the activity.
 */
export function detailExtras(
  activity: AlertActivityRepository,
  alertId: string,
  spec: AlertSpec,
): Pick<AlertDetail, 'channels' | 'sends' | 'activity'> {
  return {
    channels: activity.channels(spec.channels),
    sends: activity.sends(alertId, recentSends),
    activity: activity.changes(alertId, recentChanges).flatMap(activityOf),
  };
}
