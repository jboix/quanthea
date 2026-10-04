import { describe, expect, test } from 'bun:test';
import {
  clockWhen,
  conditionWords,
  durationSince,
  pendingProgress,
  seriesName,
  valueText,
} from './words.ts';

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

describe('the condition in words', () => {
  test('a threshold with its wait, in the alert format', () => {
    const percent = { $fmt: 'percent', decimals: 1 } as const;
    const condition = { kind: 'threshold', op: 'above', value: 0.02, for: '5m' } as const;
    expect(conditionWords(condition, percent)).toBe('above 2% for 5m');
    expect(conditionWords({ ...condition, op: 'below', value: 10, for: '0m' }, null)).toBe(
      'below 10',
    );
  });

  test('no data', () => {
    expect(conditionWords({ kind: 'no_data', for: '10m' }, null)).toBe('no data for 10m');
  });
});

test('values read with four significant digits without a format, a dash for none', () => {
  expect(valueText(1234.567, null)).toBe('1,235');
  expect(valueText(null, null)).toBe('–');
});

test('a series is named by its label values, or all', () => {
  expect(seriesName({ service: 'checkout-svc' })).toBe('checkout-svc');
  expect(seriesName({ code: '500', service: 'cart' })).toBe('500, cart');
  expect(seriesName({})).toBe('all');
});

describe('durations', () => {
  test('since a time: minutes, hours under two days, then days', () => {
    expect(durationSince(1000, 1000)).toBe('1 min');
    expect(durationSince(0, 18 * minute + 5000)).toBe('18 min');
    expect(durationSince(0, 2 * hour)).toBe('2 h');
    expect(durationSince(0, 47 * hour)).toBe('47 h');
    expect(durationSince(0, 3 * day)).toBe('3 d');
  });

  test('how far a pending series is through its wait', () => {
    expect(pendingProgress(0, '5m', 2 * minute + 10_000)).toBe('2 of 5 min');
    expect(pendingProgress(0, '5m', 9 * minute)).toBe('5 of 5 min');
    expect(pendingProgress(0, '4h', 90 * minute)).toBe('1 of 4 h');
  });
});

test('times read as the clock today, the weekday within a week, else the date', () => {
  const now = Date.UTC(2026, 9, 4, 15, 0);
  expect(clockWhen(Date.UTC(2026, 9, 4, 9, 5), now, 'UTC')).toBe('09:05');
  expect(clockWhen(Date.UTC(2026, 9, 2, 14, 22), now, 'UTC')).toBe('Fri 14:22');
  expect(clockWhen(Date.UTC(2026, 8, 20, 8, 0), now, 'UTC')).toBe('20 Sep 08:00');
});
