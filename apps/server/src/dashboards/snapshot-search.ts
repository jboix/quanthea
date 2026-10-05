/**
 * The Library's search of snapshots. The live snapshots are few, since most expire, so the search
 * is a plain match over their words: the title, the version, the taker's name and the period as
 * the person reads it. A snapshot is listed only when the caller may see its version.
 */
import {
  dayMonthTime,
  dayMonthYear,
  type SnapshotFilter,
  type SnapshotQuery,
  type SnapshotSummary,
} from '@quanthea/shared';

/** A day, in milliseconds. */
const dayMs = 86_400_000;

/**
 * A live snapshot in a list, naming its taker by user id, with whether everyone sees the version
 * it froze.
 */
export type ListedSnapshot = Omit<SnapshotSummary, 'takenBy'> & {
  /** The user id of whoever took it. */
  readonly takerId: string;
  /** Whether its dashboard is pinned and its version was pinned at some time. */
  readonly shown: boolean;
};

/** What the search needs to know about the caller. */
export interface SnapshotAccess {
  /**
   * Whether the caller may see a snapshot's version.
   *
   * @param snapshot - The snapshot.
   * @returns `true` to list it.
   */
  readonly maySee: (snapshot: ListedSnapshot) => boolean;
  /**
   * Names a taker.
   *
   * @param takerId - The taker's user id.
   * @returns Their name.
   */
  readonly nameOf: (takerId: string) => Promise<string>;
}

/** One page of the search. */
export interface SnapshotPage {
  /** The snapshots on the page, the newest first. */
  readonly snapshots: SnapshotSummary[];
  /** How many match, over every page. */
  readonly total: number;
}

/**
 * Whether a snapshot passes a filter.
 *
 * @param snapshot - The snapshot.
 * @param filter - The filter.
 * @param now - The current time.
 * @returns `true` when it passes.
 */
function passes(snapshot: SnapshotSummary, filter: SnapshotFilter, now: number): boolean {
  if (filter === 'kept') return snapshot.expiresAt === null;
  if (filter === 'expiring')
    return snapshot.expiresAt !== null && snapshot.expiresAt <= now + 7 * dayMs;
  return true;
}

/**
 * The words a snapshot is found by, in lower case.
 *
 * @param snapshot - The snapshot.
 * @param now - The current time, for the year.
 * @param timeZone - The zone the period is written in.
 * @returns The words, joined by spaces.
 */
function wordsOf(snapshot: SnapshotSummary, now: number, timeZone: string | undefined): string {
  const { from, to } = snapshot.time;
  const period = [dayMonthTime(from, now, timeZone), dayMonthTime(to, now, timeZone)];
  const years = [dayMonthYear(from, timeZone), dayMonthYear(to, timeZone)];
  const words = [snapshot.title, `v${snapshot.version}`, snapshot.takenBy, ...period, ...years];
  return words.join(' ').toLocaleLowerCase();
}

/**
 * Whether a snapshot matches every word of a search.
 *
 * @param snapshot - The snapshot.
 * @param query - The search.
 * @param now - The current time.
 * @returns `true` when it matches, or when there are no words.
 */
function matches(snapshot: SnapshotSummary, query: SnapshotQuery, now: number): boolean {
  const searched = (query.q ?? '').toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (searched.length === 0) return true;
  const words = wordsOf(snapshot, now, query.timeZone);
  return searched.every((word) => words.includes(word));
}

/**
 * Searches the live snapshots the caller may see.
 *
 * @param listed - Every live snapshot, the newest first.
 * @param query - The words, the filter, the time zone and the page.
 * @param access - What the caller may see, and the takers' names.
 * @param now - The current time.
 * @returns The page and how many match.
 */
export async function findSnapshots(
  listed: readonly ListedSnapshot[],
  query: SnapshotQuery,
  access: SnapshotAccess,
  now: number,
): Promise<SnapshotPage> {
  const visible = listed.filter(access.maySee);
  const named = await Promise.all(
    visible.map(async ({ takerId, shown: _shown, ...info }) => ({
      ...info,
      takenBy: await access.nameOf(takerId),
    })),
  );
  const found = named.filter(
    (snapshot) => passes(snapshot, query.filter, now) && matches(snapshot, query, now),
  );
  const snapshots = found.slice(query.offset, query.offset + query.limit);
  return { snapshots, total: found.length };
}
