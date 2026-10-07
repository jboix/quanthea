import { describe, expect, test } from 'bun:test';
import type { ThreadListItem } from '@quanthea/shared';
import {
  binBlocker,
  binDraftsQuestion,
  filterThreads,
  groupByDay,
  isLive,
  ownDrafts,
} from './thread-list.ts';

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
    kind: 'dashboard',
    dashboardId: null,
    alertId: null,
    alertActive: false,
    reportId: null,
    reportActive: false,
    tokensUsed: 0,
    providerId: null,
    queries: { mode: 'default' },
    createdAt: updatedAt,
    updatedAt,
    pinned,
    ownerId: 'me',
    ownerName: null,
    restrictedData: false,
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
      filterThreads(threads, { text, status: 'all', everyone: false }).map((each) => each.id);
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
    expect(filterThreads(others, { text: '', status: 'all', everyone: false })).toHaveLength(5);
    const everyone = filterThreads(others, { text: 'lovelace', status: 'all', everyone: true });
    expect(everyone.map((each) => each.id)).toEqual(['f']);
  });

  test('show the live ones (pinned, or an active alert) or the drafts, with the search', () => {
    const withAlert = [...threads, { ...thread('g', 'Checkout alert', 0), alertActive: true }];
    const ids = (status: 'all' | 'live' | 'drafts', text = '') =>
      filterThreads(withAlert, { text, status, everyone: false }).map((each) => each.id);
    expect(ids('live')).toEqual(['a', 'd', 'g']);
    expect(ids('drafts')).toEqual(['b', 'c', 'e']);
    expect(ids('all')).toHaveLength(6);
    expect(ids('live', 'checkout errors')).toEqual(['d']);
    expect(ids('drafts', 'checkout')).toEqual([]);
    expect(isLive(withAlert[5] ?? thread('x', null, 0))).toBe(true);
  });

  test('say why a thread cannot go to the bin: a pinned dashboard, or an active alert', () => {
    expect(binBlocker(thread('a', 'x', 0))).toBeNull();
    expect(binBlocker(thread('a', 'x', 0, true))).toBe('Unpin its dashboard to delete this thread');
    const alert = { ...thread('b', 'y', 0), kind: 'alert' as const, alertId: 'al1' };
    expect(binBlocker({ ...alert, alertActive: true })).toBe(
      'Deactivate its alert to delete this thread',
    );
    expect(binBlocker(alert)).toBeNull();
  });

  test('treat a thread whose report is active like one whose alert is active', () => {
    const report = { ...thread('r', 'Weekly sales', 0), kind: 'report' as const, reportId: 'r1' };
    const live = { ...report, reportActive: true };
    expect(isLive(live)).toBe(true);
    expect(isLive(report)).toBe(false);
    expect(binBlocker(live)).toBe('Deactivate its report first');
    expect(binBlocker(report)).toBeNull();
    expect(ownDrafts([...threads, live, report]).map((each) => each.id)).toEqual([
      'b',
      'c',
      'e',
      'r',
    ]);
    const ids = (status: 'live' | 'drafts') =>
      filterThreads([live], { text: '', status, everyone: false }).map((each) => each.id);
    expect(ids('live')).toEqual(['r']);
    expect(ids('drafts')).toEqual([]);
  });

  test('count only one’s own drafts for Delete all my drafts, and ask before moving them', () => {
    const mixed = [
      ...threads,
      { ...thread('f', 'Ada’s draft', 0), ownerName: 'Ada Lovelace' },
      { ...thread('g', 'Live alert', 0), alertActive: true },
    ];
    expect(ownDrafts(mixed).map((each) => each.id)).toEqual(['b', 'c', 'e']);
    expect(binDraftsQuestion(12)).toBe(
      'Move 12 drafts to the bin? You can restore them from the bin until they are purged.',
    );
    expect(binDraftsQuestion(1)).toStartWith('Move 1 draft to the bin?');
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
