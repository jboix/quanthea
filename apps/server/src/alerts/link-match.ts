/**
 * What links read without the database: the panels of pinned versions with their queries'
 * fingerprints, the panels whose query an alert's matches, and an alert's firing periods over a
 * range from its changes of state.
 */
import type { QueryTemplate, ResolvedTimeRange } from '@quanthea/shared';
import type { FiringChange } from '../db/alert-link-repository.ts';
import type { SeriesRow } from '../db/alert-state-repository.ts';
import type { PinnedRow } from '../db/dashboard-pinned.ts';
import { queryFingerprint } from './fingerprint.ts';

/** A panel of a pinned version, with the fingerprints of its queries. */
export interface PinnedPanel {
  /** The dashboard. */
  readonly dashboardId: string;
  /** Its title. */
  readonly dashboardTitle: string;
  /** The pinned version. */
  readonly version: number;
  /** The panel. */
  readonly panelId: string;
  /** Its title. */
  readonly panelTitle: string;
  /** The fingerprints of its queries. */
  readonly fingerprints: readonly string[];
}

/** A panel as a stored spec holds it, read loosely. */
interface StoredPanel {
  /** The panel id. */
  readonly id?: unknown;
  /** The title. */
  readonly title?: unknown;
  /** The queries. */
  readonly queries?: unknown;
}

/** A firing period of one series; `to` is `null` while it still fires. */
export interface FiringPeriod {
  /** The series' labels. */
  readonly labels: Readonly<Record<string, string>>;
  /** When it started firing, or the start of the range. */
  readonly from: number;
  /** When it stopped. */
  readonly to: number | null;
}

/** The most firing periods an alert shows on a dashboard. */
const maxPeriods = 500;

/**
 * The fingerprint of a stored query, or `null` when it does not read as one.
 *
 * @param query - The query, as stored.
 * @returns The fingerprint.
 */
export function fingerprintOf(query: unknown): string | null {
  try {
    return queryFingerprint(query as QueryTemplate);
  } catch {
    return null;
  }
}

/**
 * The panels of a stored spec, read loosely.
 *
 * @param spec - The spec, as stored.
 * @returns Its panels.
 */
export function storedPanels(spec: unknown): StoredPanel[] {
  const panels = (spec as { readonly panels?: unknown } | null)?.panels;
  return Array.isArray(panels) ? (panels as StoredPanel[]) : [];
}

/**
 * The panels of the pinned versions, with their queries' fingerprints.
 *
 * @param rows - The pinned dashboards.
 * @returns The panels.
 */
export function pinnedPanels(rows: readonly PinnedRow[]): PinnedPanel[] {
  return rows.flatMap((row) =>
    storedPanels(row.spec).map((panel) => {
      const queries = Array.isArray(panel.queries) ? (panel.queries as unknown[]) : [];
      return {
        dashboardId: row.dashboardId,
        dashboardTitle: row.title,
        version: row.version,
        panelId: String(panel.id),
        panelTitle: String(panel.title),
        fingerprints: queries.map(fingerprintOf).filter((each) => each !== null),
      };
    }),
  );
}

/**
 * The panels whose queries include one with the same fingerprint as a query.
 *
 * @param query - The alert's query, as stored.
 * @param panels - The panels of the pinned versions.
 * @returns The matching panels.
 */
export function matchingPanels(query: unknown, panels: readonly PinnedPanel[]): PinnedPanel[] {
  const fingerprint = fingerprintOf(query);
  if (fingerprint === null) return [];
  return panels.filter((panel) => panel.fingerprints.includes(fingerprint));
}

/**
 * The key of an alert and a panel, to tell pairs apart.
 *
 * @param alertId - The alert.
 * @param panel - The dashboard and the panel.
 * @param panel.dashboardId - The dashboard.
 * @param panel.panelId - The panel.
 * @returns The key.
 */
export function pairKey(
  alertId: string,
  panel: { readonly dashboardId: string; readonly panelId: string },
): string {
  return JSON.stringify([alertId, panel.dashboardId, panel.panelId]);
}

/**
 * Pairs the starts and ends of firing into periods, the ones still open last.
 *
 * @param changes - The changes into and out of firing, the oldest first.
 * @returns The periods, and the series still firing by key.
 */
function pairChanges(changes: readonly FiringChange[]) {
  const open = new Map<string, FiringPeriod>();
  const periods: FiringPeriod[] = [];
  for (const change of changes) {
    const started = open.get(change.seriesKey);
    if (change.started)
      open.set(change.seriesKey, { labels: change.labels, from: change.at, to: null });
    else if (started) {
      periods.push({ ...started, to: change.at });
      open.delete(change.seriesKey);
    }
  }
  return { periods, open };
}

/**
 * An alert's firing periods within a range: each start of firing paired with its end. A series
 * firing now whose start is older than the changes kept fires from when it entered its state.
 *
 * @param changes - The changes into and out of firing up to the range's end, the oldest first.
 * @param series - The series now.
 * @param range - The range.
 * @returns The periods that overlap the range, clipped to its start, at most 500.
 */
export function firingPeriods(
  changes: readonly FiringChange[],
  series: readonly SeriesRow[],
  range: ResolvedTimeRange,
): FiringPeriod[] {
  const { periods, open } = pairChanges(changes);
  for (const now of series)
    if (now.state === 'firing' && !open.has(now.key) && now.since <= range.to)
      open.set(now.key, { labels: now.labels, from: now.since, to: null });
  return [...periods, ...open.values()]
    .filter((period) => period.from < range.to && (period.to === null || period.to > range.from))
    .map((period) => ({ ...period, from: Math.max(period.from, range.from) }))
    .slice(-maxPeriods);
}
