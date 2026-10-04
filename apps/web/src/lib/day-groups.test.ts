import { expect, test } from 'bun:test';
import { groupByDay } from './day-groups.ts';

const now = new Date(2026, 9, 4, 15, 0);

/**
 * An instant some days before {@link now}.
 *
 * @param daysAgo - How many days before.
 * @returns Epoch milliseconds.
 */
function daysAgo(daysAgo: number): number {
  return new Date(2026, 9, 4 - daysAgo, 9, 0).getTime();
}

test('groups items by the day they changed, keeping their order', () => {
  const conversations = [
    { id: 'a', lastAt: daysAgo(0) },
    { id: 'b', lastAt: daysAgo(0) },
    { id: 'c', lastAt: daysAgo(1) },
    { id: 'd', lastAt: daysAgo(5) },
    { id: 'e', lastAt: daysAgo(90) },
  ];
  const groups = groupByDay(conversations, (each) => each.lastAt, now);
  expect(groups.map(({ label, items }) => [label, items.map(({ id }) => id)])).toEqual([
    ['Today', ['a', 'b']],
    ['Yesterday', ['c']],
    ['Previous 7 days', ['d']],
    ['Older', ['e']],
  ]);
  expect(groupByDay([], (each: { lastAt: number }) => each.lastAt, now)).toEqual([]);
});

test('counts the calendar days of a time zone', () => {
  const late = new Date(Date.UTC(2026, 9, 4, 23, 30));
  const evening = { lastAt: Date.UTC(2026, 9, 4, 20, 0) };
  const label = (timeZone: string) =>
    groupByDay([evening], (each) => each.lastAt, late, timeZone)[0]?.label;
  expect(label('UTC')).toBe('Today');
  // In Zurich it is already 5 Oct, 01:30; the evening was 4 Oct, 22:00.
  expect(label('Europe/Zurich')).toBe('Yesterday');
});
