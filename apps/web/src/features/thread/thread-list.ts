/** The past threads as the drawer lists them: filtered by words and pins, grouped by day. */
import type { ThreadListItem } from '@quanthea/shared';
import { groupByDay as groupByDays } from '../../lib/day-groups.ts';

/** What the drawer narrows the threads to. */
export interface ThreadFilter {
  /** Words that must all appear in the title. */
  readonly text: string;
  /** Only threads whose dashboard has a pinned version. */
  readonly pinnedOnly: boolean;
  /** Everyone's threads too, for admins; one's own only otherwise. */
  readonly everyone: boolean;
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

/**
 * The threads that pass a filter.
 *
 * @param threads - The threads.
 * @param filter - The words, whether only pinned ones count, and whether others' count.
 * @returns The threads that pass, in the same order.
 */
export function filterThreads(
  threads: readonly ThreadListItem[],
  filter: ThreadFilter,
): ThreadListItem[] {
  const words = filter.text.toLowerCase().split(/\s+/).filter(Boolean);
  return threads.filter((thread) => {
    if (filter.pinnedOnly && !thread.pinned) return false;
    if (!filter.everyone && thread.ownerName !== null) return false;
    const text = `${thread.title ?? untitled} ${thread.ownerName ?? ''}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/**
 * Why a thread cannot go to the bin, as the server refuses it: its dashboard is pinned, or its
 * alert is active.
 *
 * @param thread - The thread.
 * @returns What to do first, or `null` when it can go.
 */
export function binBlocker(thread: ThreadListItem): string | null {
  if (thread.pinned) return 'Unpin its dashboard to delete this thread';
  if (thread.alertActive) return 'Deactivate its alert to delete this thread';
  return null;
}

/**
 * Groups threads by how long ago they last changed.
 *
 * @param threads - The threads, the latest first.
 * @param now - The current time.
 * @returns The groups that have threads, the latest first.
 */
export function groupByDay(threads: readonly ThreadListItem[], now: Date): ThreadGroup[] {
  return groupByDays(threads, (thread) => thread.updatedAt, now).map(({ label, items }) => ({
    label,
    threads: items,
  }));
}
