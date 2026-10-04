/**
 * Turns stored alerts into what the API returns. People are named by user id here; the routes
 * replace the ids with names.
 */
import {
  type AlertDetail,
  type AlertListItem,
  type AlertState,
  type AlertSummary,
  alertSpecSchema,
  alertStates,
  hasRole,
  type Role,
} from '@quanthea/shared';
import type { AlertRow, AlertVersionRow } from '../db/alert-repository.ts';
import type { EventRow, SeriesRow } from '../db/alert-state-repository.ts';

/** How many series an alert has in each state, as stored. */
export type StateCounts = Partial<Record<AlertState, number>>;

/**
 * Whether a role may see an alert: editors see every alert, others those with an active version.
 *
 * @param alert - The alert.
 * @param role - The role.
 * @returns `true` when the role may see it.
 */
export function canSeeAlert(alert: AlertRow, role: Role): boolean {
  return hasRole(role, 'editor') || alert.activeVersion !== null;
}

/**
 * Whether a role may see a version: editors see every version, others those ever active.
 *
 * @param version - The version.
 * @param role - The role.
 * @returns `true` when the role may see it.
 */
export function canSeeVersion(version: AlertVersionRow, role: Role): boolean {
  return hasRole(role, 'editor') || version.activatedAt !== null;
}

/**
 * Counts series by state.
 *
 * @param series - The series.
 * @returns How many are in each state.
 */
export function countStates(series: readonly SeriesRow[]): StateCounts {
  const counts: StateCounts = {};
  for (const each of series) counts[each.state] = (counts[each.state] ?? 0) + 1;
  return counts;
}

/**
 * Summarizes an alert.
 *
 * @param alert - The alert.
 * @param shown - The version that sets its severity: the active one, else the latest.
 * @param role - The role of the reader: the latest version, a draft maybe, shows to editors only.
 * @param counts - How many series it has in each state.
 * @returns The summary.
 */
export function toSummary(
  alert: AlertRow,
  shown: AlertVersionRow,
  role: Role,
  counts: StateCounts = {},
): AlertSummary {
  const { mutedAt, mutedBy, mutedUntil } = alert;
  const muted = mutedAt === null ? null : { at: mutedAt, by: mutedBy ?? '', until: mutedUntil };
  return {
    id: alert.id,
    title: alert.title,
    severity: alertSpecSchema.parse(shown.spec).severity,
    activeVersion: alert.activeVersion,
    latestVersion: hasRole(role, 'editor') ? alert.latestVersion : null,
    deactivated: alert.deactivatedAt !== null,
    muted,
    evaluatedAt: alert.evaluatedAt,
    states: Object.fromEntries(
      alertStates.map((state) => [state, counts[state] ?? 0]),
    ) as AlertSummary['states'],
    threadId: alert.threadId,
    createdAt: alert.createdAt,
    updatedAt: alert.updatedAt,
  };
}

/**
 * Builds an alert's detail, but for its channels, sends and activity.
 *
 * @param summary - Its list item.
 * @param parts - Its versions, series and recent changes of state.
 * @param role - The role of the reader, for the versions shown.
 * @returns The detail.
 */
export function toDetail(
  summary: AlertListItem,
  parts: {
    readonly versions: readonly AlertVersionRow[];
    readonly series: readonly SeriesRow[];
    readonly events: readonly EventRow[];
  },
  role: Role,
): Omit<AlertDetail, 'channels' | 'sends' | 'activity'> {
  const versions = parts.versions
    .filter((version) => canSeeVersion(version, role))
    .map((version) => ({
      version: version.version,
      spec: alertSpecSchema.parse(version.spec),
      note: version.note,
      createdBy: version.createdBy,
      createdAt: version.createdAt,
      activatedAt: version.activatedAt,
    }));
  const series = parts.series.map(({ lastSeenAt: _seen, announced: _announced, ...each }) => ({
    ...each,
    labels: { ...each.labels },
  }));
  const events = parts.events.map((event) => ({
    ...event,
    labels: { ...event.labels },
  }));
  return { ...summary, versions, series, events };
}
