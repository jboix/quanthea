import { describe, expect, test } from 'bun:test';
import type { ThreadListItem } from '@querent/shared';
import { filterThreads, groupByDay } from './thread-list.ts';

const now = new Date(2026, 8, 29, 15, 0);

/**
 * A thread changed some days before {@link now}.
 *
 * @param id - The id.
 * @param title - The title.
 * @param daysAgo - How many days before now it changed.
 * @param pinned - Whether its dashboard is pinned.
 * @returns The thread.
 */
function thread(id: string, title: string | null, daysAgo: number, pinned = false): ThreadListItem {
  const updatedAt = new Date(2026, 8, 29 - daysAgo, 9, 0).getTime();
  return {
    id,
    title,
    state: 'ready',
    dashboardId: null,
    tokensUsed: 0,
    providerId: null,
    queries: { mode: 'default' },
    createdAt: updatedAt,
    updatedAt,
    pinned,
    ownerId: 'me',
    ownerName: null,
  };
}

const threads = [
  thread('a', 'Checkout latency', 0, true),
  thread('b', 'Payment errors', 1),
  thread('c', null, 3),
  thread('d', 'Checkout errors by route', 12, true),
  thread('e', 'Old incident', 90),
];

describe('the past threads', () => {
  test('match every word of the search in the title, and untitled ones by that name', () => {
    const ids = (text: string) =>
      filterThreads(threads, { text, pinnedOnly: false, everyone: false }).map((each) => each.id);
    expect(ids('checkout')).toEqual(['a', 'd']);
    expect(ids('ERRORS check')).toEqual(['d']);
    expect(ids('untitled')).toEqual(['c']);
    expect(ids('  ')).toHaveLength(5);
  });

  test('show others’ threads only when asked, found by their owner too', () => {
    const others = [
      ...threads,
      { ...thread('f', 'Checkout for Ada', 0), ownerName: 'Ada Lovelace' },
    ];
    expect(filterThreads(others, { text: '', pinnedOnly: false, everyone: false })).toHaveLength(5);
    const everyone = filterThreads(others, { text: 'lovelace', pinnedOnly: false, everyone: true });
    expect(everyone.map((each) => each.id)).toEqual(['f']);
  });

  test('keep only pinned ones when asked', () => {
    const pinned = filterThreads(threads, { text: '', pinnedOnly: true, everyone: false });
    expect(pinned.map((each) => each.id)).toEqual(['a', 'd']);
  });

  test('group by how long ago they changed', () => {
    expect(
      groupByDay(threads, now).map(({ label, threads: members }) => [label, members.length]),
    ).toEqual([
      ['Today', 1],
      ['Yesterday', 1],
      ['Previous 7 days', 1],
      ['Previous 30 days', 1],
      ['Older', 1],
    ]);
  });
});
