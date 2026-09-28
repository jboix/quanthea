import { expect, test } from 'bun:test';
import { checkTimeRange } from './guardrails.ts';

const guardrails = { timeoutMs: 10_000, maxRows: 100, maxRangeDays: 7 };

test('accepts a range up to the limit', () => {
  const from = new Date('2026-09-01T00:00:00Z');
  expect(() =>
    checkTimeRange({ from, to: new Date('2026-09-08T00:00:00Z') }, guardrails),
  ).not.toThrow();
});

test('refuses a range longer than the limit, and a reversed range', () => {
  const from = new Date('2026-09-01T00:00:00Z');
  expect(() => checkTimeRange({ from, to: new Date('2026-09-08T00:00:01Z') }, guardrails)).toThrow(
    '(7 days)',
  );
  expect(() => checkTimeRange({ from, to: new Date('2026-08-31T00:00:00Z') }, guardrails)).toThrow(
    'ends before it starts',
  );
  expect(() => checkTimeRange({ from, to: new Date(Number.NaN) }, guardrails)).toThrow(
    'ends before it starts',
  );
});
