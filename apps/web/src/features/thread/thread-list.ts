/**
 * The past threads as the drawer lists them: filtered by words and by status, grouped by day. A
 * thread is live when its dashboard is pinned or its alert or report is active, and a draft
 * otherwise.
 */
import type { ThreadListItem } from '@quanthea/shared';
import { groupByDay as groupByDays } from '../../lib/day-groups.ts';

/** The statuses the drawer shows: every thread, the live ones, or the drafts. */
export const threadStatuses = ['all', 'live', 'drafts'] as const;

/** A status the drawer shows. */
export type ThreadStatus = (typeof threadStatuses)[number];

/** What the drawer narrows the threads to. */
export interface ThreadFilter {
  /** Words that must all appear in the title. */
  readonly text: string;
  /** All threads, the live ones only, or the drafts only. */
  readonly status: ThreadStatus;
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
 * Whether a thread is live: its dashboard is pinned, or its alert or report is active.
 *
 * @param thread - The thread.
 * @returns `true` when live, `false` for a draft.
 */
export function isLive(thread: ThreadListItem): boolean {
  return thread.pinned || thread.alertActive || thread.reportActive;
}

/**
 * Whether a thread has a status.
 *
 * @param thread - The thread.
 * @param status - The status.
 * @returns `true` for every thread with `all`.
 */
function hasStatus(thread: ThreadListItem, status: ThreadStatus): boolean {
  if (status === 'all') return true;
  return isLive(thread) === (status === 'live');
}

/**
 * The threads that pass a filter.
 *
 * @param threads - The threads.
 * @param filter - The words, the status, and whether others' count.
 * @returns The threads that pass, in the same order.
 */
export function filterThreads(
  threads: readonly ThreadListItem[],
  filter: ThreadFilter,
): ThreadListItem[] {
  const words = filter.text.toLowerCase().split(/\s+/).filter(Boolean);
  return threads.filter((thread) => {
    if (!hasStatus(thread, filter.status)) return false;
    if (!filter.everyone && thread.ownerName !== null) return false;
    const text = `${thread.title ?? untitled} ${thread.ownerName ?? ''}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/**
 * The person's own drafts: the threads Delete all my drafts moves to the bin.
 *
 * @param threads - The threads listed, others' included for an admin.
 * @returns Their own threads that are not live.
 */
export function ownDrafts(threads: readonly ThreadListItem[]): ThreadListItem[] {
  return threads.filter((thread) => thread.ownerName === null && !isLive(thread));
}

/**
 * What Delete all my drafts asks before moving them.
 *
 * @param count - How many drafts.
 * @returns The question.
 */
export function binDraftsQuestion(count: number): string {
  const drafts = count === 1 ? '1 draft' : `${count} drafts`;
  return `Move ${drafts} to the bin? You can restore them from the bin until they are purged.`;
}

/**
 * Why a thread cannot go to the bin, as the server refuses it: its dashboard is pinned, or its
 * alert or report is active.
 *
 * @param thread - The thread.
 * @returns What to do first, or `null` when it can go.
 */
export function binBlocker(thread: ThreadListItem): string | null {
  if (thread.pinned) return 'Unpin its dashboard to delete this thread';
  if (thread.alertActive) return 'Deactivate its alert to delete this thread';
  if (thread.reportActive) return 'Deactivate its report first';
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
