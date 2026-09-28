import { expect, test } from 'bun:test';
import type { Frame } from '@querent/shared';
import { createResultCache } from './result-cache.ts';

const frames: Frame[] = [
  { refId: 'A', fields: [], values: [], meta: { rowCount: 0, truncated: false, durationMs: 0 } },
];

test('returns a result until it expires', () => {
  let now = 1000;
  const cache = createResultCache({ ttlMs: 15_000, maxEntries: 10, now: () => now });
  cache.set('k', frames);
  now += 14_999;
  expect(cache.get('k')).toBe(frames);
  now += 1;
  expect(cache.get('k')).toBeUndefined();
});

test('forgets the oldest result past the size limit', () => {
  const cache = createResultCache({ ttlMs: 15_000, maxEntries: 2 });
  cache.set('a', frames);
  cache.set('b', frames);
  cache.set('c', frames);
  expect(cache.get('a')).toBeUndefined();
  expect(cache.get('b')).toBe(frames);
  expect(cache.get('c')).toBe(frames);
});
