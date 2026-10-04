/** Alerts for the tests of the feature. */
import type { AlertDetail, AlertListItem } from '@quanthea/shared';

/** No series in any state. */
const noSeries = { ok: 0, pending: 0, firing: 0, no_data: 0, error: 0 };

/**
 * An active alert above 2% for 5m, OK, with the fields a test changes.
 *
 * @param changes - The fields that differ.
 * @returns The alert.
 */
export function listedAlert(changes: Partial<AlertListItem> = {}): AlertListItem {
  return {
    id: 'a1',
    title: 'Checkout 5xx rate',
    severity: 'critical',
    activeVersion: 1,
    latestVersion: 1,
    deactivated: false,
    muted: null,
    evaluatedAt: 1,
    states: { ...noSeries, ok: 1 },
    threadId: null,
    createdAt: 1,
    updatedAt: 1,
    condition: { kind: 'threshold', op: 'above', value: 0.02, for: '5m' },
    format: { $fmt: 'percent', decimals: 1 },
    lead: { labels: { service: 'web' }, state: 'ok', since: 0, value: 0.01 },
    seriesCount: 1,
    lastNotification: null,
    ...changes,
  };
}

/**
 * The same alert with its detail, with the fields a test changes.
 *
 * @param changes - The fields that differ.
 * @returns The alert.
 */
export function detailedAlert(changes: Partial<AlertDetail> = {}): AlertDetail {
  return {
    ...listedAlert(),
    versions: [],
    series: [],
    events: [],
    channels: [],
    sends: [],
    activity: [],
    ...changes,
  };
}
