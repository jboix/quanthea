/** How snapshots read on screen: their lifetimes, their range and how long they live. */
import type { SnapshotLifetime, SnapshotSummary } from '@quanthea/shared';
import { timeLabel } from './view-state.ts';

/** The lifetimes a taker picks from, in order, with their words. */
export const lifetimeChoices: readonly {
  readonly value: SnapshotLifetime;
  readonly label: string;
}[] = [
  { value: '1d', label: '1 day' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'forever', label: 'Until revoked' },
];

/**
 * An instant as a short date and time, in the browser's zone.
 *
 * @param at - Epoch milliseconds.
 * @returns Such as `2 Oct 2026, 14:02`.
 */
export function dateTimeWords(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * The time range a snapshot froze.
 *
 * @param time - The range, in epoch milliseconds.
 * @param timeZone - The dashboard's zone, if it sets one.
 * @returns Such as `30 Sep, 13:00 – 15:00`.
 */
export function rangeWords(time: SnapshotSummary['time'], timeZone?: string): string {
  const range = { from: new Date(time.from).toISOString(), to: new Date(time.to).toISOString() };
  return timeLabel(range, timeZone);
}

/**
 * How long a snapshot lives.
 *
 * @param expiresAt - When it goes, or `null`.
 * @returns Such as `until 9 Oct 2026, 14:02`, or `until revoked`.
 */
export function untilWords(expiresAt: number | null): string {
  return expiresAt === null ? 'until revoked' : `until ${dateTimeWords(expiresAt)}`;
}

/**
 * The Share menu's way to the dashboard's live snapshots, with how many there are once known.
 *
 * @param count - How many live snapshots, or `undefined` while they load or when they failed to.
 * @returns Such as `Snapshots of this dashboard (3)`.
 */
export function snapshotsLabel(count: number | undefined): string {
  const label = 'Snapshots of this dashboard';
  return count === undefined ? label : `${label} (${count})`;
}
