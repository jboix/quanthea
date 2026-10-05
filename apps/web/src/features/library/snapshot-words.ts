/** How the Library's snapshot rows read: the frozen period, when one was taken and until when. */
import {
  dayMonth,
  dayMonthTime,
  type SnapshotFilter,
  type SnapshotSummary,
} from '@quanthea/shared';

/** The filter chips of the Snapshots tab, in order, with their words. */
export const filterChoices: readonly { readonly value: SnapshotFilter; readonly label: string }[] =
  [
    { value: 'all', label: 'All' },
    { value: 'expiring', label: 'Expiring this week' },
    { value: 'kept', label: 'Kept until revoked' },
  ];

/**
 * The period a snapshot froze, in the browser's zone. A period within one day names it once.
 *
 * @param time - The period, in epoch milliseconds.
 * @param now - The current time, for the year.
 * @param timeZone - The zone; the browser's when left out.
 * @returns Such as `26 Sep 13:30 – 15:00`, or `26 Sep 22:00 – 27 Sep 02:00`.
 */
export function periodWords(
  time: SnapshotSummary['time'],
  now = Date.now(),
  timeZone?: string,
): string {
  const start = dayMonthTime(time.from, now, timeZone);
  const end = dayMonthTime(time.to, now, timeZone);
  const cut = end.lastIndexOf(' ');
  const sameDay = start.slice(0, start.lastIndexOf(' ')) === end.slice(0, cut);
  return `${start} – ${sameDay ? end.slice(cut + 1) : end}`;
}

/**
 * Until when a snapshot lives.
 *
 * @param expiresAt - When it goes, or `null`.
 * @param timeZone - The zone; the browser's when left out.
 * @returns Such as `until 3 Nov`, or `kept until revoked`.
 */
export function expiryWords(expiresAt: number | null, timeZone?: string): string {
  return expiresAt === null ? 'kept until revoked' : `until ${dayMonth(expiresAt, timeZone)}`;
}

/**
 * Who took a snapshot and when.
 *
 * @param snapshot - The snapshot.
 * @param now - The current time, for the year.
 * @param timeZone - The zone; the browser's when left out.
 * @returns Such as `Taken by Ada on 26 Sep 15:02`.
 */
export function takenWords(
  snapshot: Pick<SnapshotSummary, 'takenBy' | 'takenAt'>,
  now = Date.now(),
  timeZone?: string,
): string {
  return `Taken by ${snapshot.takenBy} on ${dayMonthTime(snapshot.takenAt, now, timeZone)}`;
}
