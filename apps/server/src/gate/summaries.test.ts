import { expect, test } from 'bun:test';
import type { Frame } from '@quanthea/shared';
import { summarizeFrame } from './summaries.ts';

const minute = 60_000;
const start = Date.UTC(2026, 8, 27, 12, 0);
const errors = [1, 1, 2, 1, 1, 2, 1, 40, 1, 2, 1, 1, 2, 1, 1, 2, 1, 1, 2, 1];

const frame: Frame = {
  refId: 'A',
  fields: [
    { name: 'time', type: 'time' },
    { name: 'errors', type: 'number' },
    { name: 'service', type: 'string' },
    { name: 'ok', type: 'boolean' },
  ],
  values: [
    errors.map((_value, index) => start + index * minute),
    errors,
    errors.map((_value, index) => (index % 4 === 0 ? 'cart' : 'checkout')),
    errors.map((value) => value < 10),
  ],
  meta: { rowCount: errors.length, truncated: false, durationMs: 1 },
};

test('summarizes each field for level 3', () => {
  const [time, numbers, strings, booleans] = summarizeFrame(frame);
  expect(time).toEqual({
    field: 'time',
    type: 'time',
    count: 20,
    nulls: 0,
    from: '2026-09-27T12:00:00.000Z',
    to: '2026-09-27T12:19:00.000Z',
  });
  expect(numbers).toEqual({
    field: 'errors',
    type: 'number',
    count: 20,
    nulls: 0,
    min: 1,
    max: 40,
    mean: 3.25,
    spikes: [{ value: 40, at: '2026-09-27T12:07:00.000Z' }],
  });
  expect(strings).toEqual({
    field: 'service',
    type: 'string',
    count: 20,
    nulls: 0,
    distinct: 2,
    top: [
      { value: 'checkout', count: 15 },
      { value: 'cart', count: 5 },
    ],
  });
  expect(booleans).toEqual({ field: 'ok', type: 'boolean', count: 20, nulls: 0, true: 19 });
});

test('handles a column of nulls', () => {
  const [summary] = summarizeFrame({
    ...frame,
    fields: [{ name: 'x', type: 'number' }],
    values: [[null, null]],
    meta: { rowCount: 2, truncated: false, durationMs: 0 },
  });
  expect(summary).toEqual({ field: 'x', type: 'number', count: 0, nulls: 2, spikes: [] });
});
