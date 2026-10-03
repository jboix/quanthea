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
    minAt: '2026-09-27T12:00:00.000Z',
    maxAt: '2026-09-27T12:07:00.000Z',
    spikeWindows: [{ from: '2026-09-27T12:07:00.000Z', to: '2026-09-27T12:07:00.000Z', peak: 40 }],
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

test('says when a number was lowest, highest and spiking, merging consecutive spikes', () => {
  const values = Array.from({ length: 40 }, () => 1);
  values[10] = 90;
  values[11] = 100;
  values[25] = 95;
  values[30] = 0;
  const [, summary] = summarizeFrame({
    ...frame,
    fields: [
      { name: 'time', type: 'time' },
      { name: 'latency', type: 'number' },
    ],
    values: [values.map((_value, index) => start + index * minute), values],
    meta: { rowCount: values.length, truncated: false, durationMs: 1 },
  });
  expect(summary).toMatchObject({
    minAt: '2026-09-27T12:30:00.000Z',
    maxAt: '2026-09-27T12:11:00.000Z',
    spikeWindows: [
      { from: '2026-09-27T12:10:00.000Z', to: '2026-09-27T12:11:00.000Z', peak: 100 },
      { from: '2026-09-27T12:25:00.000Z', to: '2026-09-27T12:25:00.000Z', peak: 95 },
    ],
  });
});

test('gives no times without a time column', () => {
  const [summary] = summarizeFrame({
    ...frame,
    fields: [{ name: 'x', type: 'number' }],
    values: [[1, 2, 3]],
    meta: { rowCount: 3, truncated: false, durationMs: 0 },
  });
  expect(summary).toEqual({
    field: 'x',
    type: 'number',
    count: 3,
    nulls: 0,
    min: 1,
    max: 3,
    mean: 2,
    spikes: [],
  });
});
