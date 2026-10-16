import { expect, test } from 'bun:test';
import type { DefinitionBody } from '@quanthea/shared';
import { bodyPlace, bodyWords } from './body-words.ts';

test('a ratio reads as the share of its part out of its whole', () => {
  const body: DefinitionBody = {
    shape: 'ratio',
    request: { kind: 'sql-ratio', table: 'orders', match: [{ field: 'status', value: 'failed' }] },
  };
  expect(bodyWords(body)).toBe(
    'The share of orders where status is "failed", out of every row of orders.',
  );
  expect(bodyPlace({ ...body, connectors: ['postgres-orders'] })).toBe('SQL, on postgres-orders');
});

test('a measure reads as what it measures over which rows', () => {
  const body: DefinitionBody = {
    shape: 'measure',
    request: {
      kind: 'sql-stat',
      table: 'orders',
      filters: [{ field: 'status', op: '!=', value: 'cancelled' }],
      measure: { fn: 'sum', column: 'total_cents' },
    },
  };
  expect(bodyWords(body)).toBe(
    'The sum of total_cents over orders where status is not "cancelled".',
  );
});

test('a segment reads as the rows it keeps', () => {
  const body: DefinitionBody = {
    shape: 'segment',
    request: { kind: 'search-stat', index: 'events', filters: [{ field: 'env', value: 'prod' }] },
  };
  expect(bodyWords(body)).toBe('Only events where env is "prod".');
});
