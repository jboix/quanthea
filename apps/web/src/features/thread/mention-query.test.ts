import { expect, test } from 'bun:test';
import { mentionAt, mentionGhost, mentionMatches } from './mention-query.ts';

const panels = [
  { id: 'a', title: 'Failed orders by reason' },
  { id: 'b', title: 'Orders failed (%)' },
  { id: 'c', title: 'Revenue' },
];

test('an @ at the start or after a space starts a mention', () => {
  expect(mentionAt('@', panels)).toEqual({ start: 0, query: '' });
  expect(mentionAt('make @Rev', panels)).toEqual({ start: 5, query: 'Rev' });
  expect(mentionAt('mail me@example', panels)).toBeUndefined();
});

test('a title with signs in it is still typed as a mention', () => {
  expect(mentionAt('@Orders failed (', panels)?.query).toBe('Orders failed (');
});

test('a whole title followed by a space ends the mention', () => {
  expect(mentionAt('@Revenue ', panels)).toBeUndefined();
  expect(mentionAt('@Revenue in CHF', panels)).toBeUndefined();
});

test('titles starting with what was typed come first', () => {
  expect(mentionMatches('or', panels).map((panel) => panel.id)).toEqual(['b', 'a']);
  expect(mentionMatches('', panels)).toHaveLength(3);
});

test('the ghost is the rest of a title that starts with what was typed', () => {
  expect(mentionGhost('Revenue', '')).toBe('Revenue');
  expect(mentionGhost('Revenue', 'rev')).toBe('enue');
  expect(mentionGhost('Failed orders by reason', 'orders')).toBe('');
});
