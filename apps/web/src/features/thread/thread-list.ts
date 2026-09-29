/** The past threads as the drawer lists them: filtered by words and pins, grouped by day. */
import type { ThreadListItem } from '@querent/shared';

/** What the drawer narrows the threads to. */
export interface ThreadFilter {
  /** Words that must all appear in the title. */
  readonly text: string;
  /** Only threads whose dashboard has a pinned version. */
  readonly pinnedOnly: boolean;
}

/** Threads last changed on the same stretch of days. */
export interface ThreadGroup {
  /** Such as "Today" or "Previous 7 days". */
  readonly label: string;
  /** The threads, the latest first. */
  readonly threads: readonly ThreadListItem[];
}

/** The title a thread shows while it has none. */
export const untitled = 'Untitled thread';

/** The groups, by the most days since a thread last changed. */
const groupLimits: readonly [number, string][] = [
  [0, 'Today'],
  [1, 'Yesterday'],
  [7, 'Previous 7 days'],
  [30, 'Previous 30 days'],
  [Number.POSITIVE_INFINITY, 'Older'],
];

/**
 * The threads that pass a filter.
 *
 * @param threads - The threads.
 * @param filter - The words and whether only pinned ones count.
 * @returns The threads that pass, in the same order.
 */
export function filterThreads(
  threads: readonly ThreadListItem[],
  filter: ThreadFilter,
): ThreadListItem[] {
  const words = filter.text.toLowerCase().split(/\s+/).filter(Boolean);
  return threads.filter((thread) => {
    if (filter.pinnedOnly && !thread.pinned) return false;
    const title = (thread.title ?? untitled).toLowerCase();
    return words.every((word) => title.includes(word));
  });
}

/**
 * The calendar days between two instants, in the browser's time zone.
 *
 * @param earlier - The earlier instant, in milliseconds.
 * @param now - The later instant.
 * @returns Whole days; 0 on the same day.
 */
function daysBetween(earlier: number, now: Date): number {
  const start = (instant: Date) =>
    new Date(instant.getFullYear(), instant.getMonth(), instant.getDate()).getTime();
  return Math.round((start(now) - start(new Date(earlier))) / 86_400_000);
}

/**
 * Groups threads by how long ago they last changed.
 *
 * @param threads - The threads, the latest first.
 * @param now - The current time.
 * @returns The groups that have threads, the latest first.
 */
export function groupByDay(threads: readonly ThreadListItem[], now: Date): ThreadGroup[] {
  const groups = new Map<string, ThreadListItem[]>();
  for (const thread of threads) {
    const days = daysBetween(thread.updatedAt, now);
    const label = groupLimits.find(([limit]) => days <= limit)?.[1] ?? 'Older';
    groups.set(label, [...(groups.get(label) ?? []), thread]);
  }
  return [...groups].map(([label, members]) => ({ label, threads: members }));
}
