import { expect, test } from 'bun:test';
import { bodyOfDraft, draftOfBody, emptyDraft } from './body-form-model.ts';

test('a ratio form writes the ratio builder, its whole as filters and its part as match', () => {
  const draft = {
    ...emptyDraft('sql'),
    source: ' orders ',
    part: [{ field: 'status', op: '=' as const, value: 'failed' }],
    filters: [{ field: '', op: '=' as const, value: 'ignored' }],
  };
  expect(bodyOfDraft(draft)).toEqual({
    shape: 'ratio',
    request: {
      kind: 'sql-ratio',
      table: 'orders',
      filters: [],
      match: [{ field: 'status', op: '=', value: 'failed' }],
    },
  });
});

test('a measure form names its column, and a count names none', () => {
  const sum = { ...emptyDraft('search'), shape: 'measure' as const, source: 'sales', fn: 'sum' };
  expect(bodyOfDraft({ ...sum, column: 'amount' }).request).toEqual({
    kind: 'search-stat',
    index: 'sales',
    filters: [],
    measure: { fn: 'sum', field: 'amount' },
  });
  expect(bodyOfDraft({ ...sum, fn: 'count', column: 'amount' }).request.measure).toEqual({
    fn: 'count',
  });
});

test('a body the form wrote reads back into the same form', () => {
  const draft = {
    ...emptyDraft('sql'),
    shape: 'measure' as const,
    source: 'orders',
    filters: [{ field: 'status', op: '!=' as const, value: 'cancelled' }],
    fn: 'sum',
    column: 'total_cents',
  };
  expect(draftOfBody(bodyOfDraft(draft))).toEqual(draft);
});

test('a request the form does not write stays out of it', () => {
  const body = {
    shape: 'ratio' as const,
    request: { kind: 'sql-ratio', table: 'orders', match: [], complement: true },
  };
  expect(draftOfBody(body)).toBeUndefined();
  expect(
    draftOfBody({ shape: 'measure', request: { kind: 'latency', metric: 'x' } }),
  ).toBeUndefined();
});
