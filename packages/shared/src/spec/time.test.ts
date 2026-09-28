import { describe, expect, test } from 'bun:test';
import { resolveTime, resolveTimeRange, timeRangeSchema } from './time.ts';

const now = Date.parse('2026-09-28T12:00:00Z');

describe('time expressions', () => {
  test('accept now, relative amounts and ISO timestamps with an offset', () => {
    for (const expression of ['now', 'now-15m', 'now-7d', 'now-1M', '2026-09-26T13:30:00+02:00']) {
      expect(timeRangeSchema.safeParse({ from: expression, to: 'now' }).success).toBe(true);
    }
    for (const expression of ['now+1d', 'yesterday', 'now-7', '2026-09-26', '']) {
      expect(timeRangeSchema.safeParse({ from: expression, to: 'now' }).success).toBe(false);
    }
  });

  test('resolve against the current instant', () => {
    expect(resolveTime('now', now)).toBe(now);
    expect(resolveTime('now-15m', now)).toBe(now - 15 * 60_000);
    expect(resolveTime('now-1w', now)).toBe(now - 7 * 86_400_000);
    expect(resolveTime('now-1M', now)).toBe(Date.parse('2026-08-28T12:00:00Z'));
    expect(resolveTime('now-2y', now)).toBe(Date.parse('2024-09-28T12:00:00Z'));
    expect(resolveTime('2026-09-26T13:30:00+02:00', now)).toBe(Date.parse('2026-09-26T11:30:00Z'));
    expect(resolveTime('nonsense', now)).toBeNaN();
  });

  test('resolve a range', () => {
    expect(resolveTimeRange({ from: 'now-6h', to: 'now' }, now)).toEqual({
      from: now - 6 * 3_600_000,
      to: now,
    });
  });
});
