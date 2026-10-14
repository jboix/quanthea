import { expect, test } from 'bun:test';
import { offersAll, type Variable } from './variables.ts';

test('a fixed list and a query-backed variable offer All when they say so, others never', () => {
  const custom: Variable = { kind: 'custom', name: 'platform', options: ['web'], default: 'web' };
  expect(offersAll(custom)).toBe(false);
  expect(offersAll({ ...custom, includeAll: true })).toBe(true);
  const source = { connector: 'prom', language: 'promql', expr: 'up' } as const;
  expect(offersAll({ kind: 'query', name: 'job', source, includeAll: true })).toBe(true);
  expect(offersAll({ kind: 'text', name: 'order', default: 'a' })).toBe(false);
});
