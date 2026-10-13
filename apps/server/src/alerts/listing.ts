/**
 * What the alert pages show beyond the stored alert: the series that stands for it, its condition,
 * the latest message sent about it, the channels it names, and the first page of its lists. People
 * are named by user id here; the routes replace the ids with names.
 */
import {
  type AlertDetail,
  type AlertListItem,
  type AlertSpec,
  type AlertState,
  type AlertSummary,
  alertPageSize,
  conditionDirection,
} from '@quanthea/shared';
import type { AlertActivityRepository, AlertSend } from '../db/alert-activity.ts';
import type { AlertPagesRepository } from '../db/alert-pages.ts';
import type { SeriesRow } from '../db/alert-state-repository.ts';
import { sendsPage, timelinePage } from './pages.ts';

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
};

/**
 * How far a value is on the side the condition points to: higher is worse.
 *
 * @param value - The value, or `null`.
 * @param spec - The spec, for the condition's direction.
 * @returns The badness; a missing value is the least bad.
 */
function badness(value: number | null, spec: AlertSpec): number {
  if (value === null) return Number.NEGATIVE_INFINITY;
  return conditionDirection(spec.condition) === 'below' ? -value : value;
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
 * What an alert's page shows besides its stored state: its channels, and the first page of what
 * happened to it and of the messages sent about it.
 *
 * @param stores - The activity store and the paged lists.
 * @param alertId - The alert.
 * @param spec - The spec of the version shown.
 * @returns The channels, the timeline and the sends.
 */
export function detailExtras(
  stores: { readonly activity: AlertActivityRepository; readonly pages: AlertPagesRepository },
  alertId: string,
  spec: AlertSpec,
): Pick<AlertDetail, 'channels' | 'timeline' | 'sends'> {
  const first = { limit: alertPageSize };
  return {
    channels: stores.activity.channels(spec.channels),
    timeline: timelinePage(stores.pages, alertId, first),
    sends: sendsPage(stores.pages, alertId, first),
  };
}
