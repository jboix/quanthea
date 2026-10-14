import { expect, test } from 'bun:test';
import type { Variable } from '@quanthea/shared';
import { shown } from './variable-chip.tsx';

const platform: Variable = {
  kind: 'custom',
  name: 'platform',
  options: ['web', { value: 'true', label: 'Only SwissTXT' }],
  default: 'web',
  includeAll: true,
};

test('a chip shows the label of a value, All for All, and a short list for several', () => {
  expect(shown('true', platform)).toBe('Only SwissTXT');
  expect(shown('$__all', platform)).toBe('All');
  expect(shown(['web', 'true'], platform)).toBe('web, Only SwissTXT');
  expect(shown(['a', 'b', 'c', 'd'])).toBe('a, b, c +1');
});

test('a query-backed chip shows the labels its source gave', () => {
  const service: Variable = {
    kind: 'query',
    name: 'service',
    source: { connector: 'pg', language: 'sql', sql: 'SELECT 1' },
  } as Variable;
  const loaded = [{ value: 'co-1', label: 'Checkout' }, 'api'];
  expect(shown(['co-1', 'api'], service, loaded)).toBe('Checkout, api');
  expect(shown('co-1', service)).toBe('co-1');
});
