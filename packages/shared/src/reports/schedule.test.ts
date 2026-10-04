import { describe, expect, test } from 'bun:test';
import { latestRunAt, nextRunAt, type ReportSchedule } from './schedule.ts';
import { instantOf, wallTimeOf } from './zoned.ts';

/** Zurich: summer time starts on 29 March 2026 and ends on 25 October 2026. */
const zurich = 'Europe/Zurich';

/**
 * An instant from its ISO text.
 *
 * @param iso - The time, with its offset.
 * @returns Epoch milliseconds.
 */
const at = (iso: string) => Date.parse(iso);

/**
 * An instant as ISO text in UTC.
 *
 * @param instant - Epoch milliseconds.
 * @returns The text.
 */
const iso = (instant: number) => new Date(instant).toISOString();

/** Every day at a time in Zurich. */
const daily = (time: string): ReportSchedule => ({ every: 'day', at: time, timezone: zurich });

describe('the wall clock of a time zone', () => {
  test('reads and writes local times across both changes', () => {
    expect(wallTimeOf(at('2026-03-29T06:00:00Z'), zurich)).toEqual({
      year: 2026,
      month: 3,
      day: 29,
      hour: 8,
      minute: 0,
    });
    const morning = { year: 2026, month: 10, day: 26, hour: 8, minute: 0 };
    expect(iso(instantOf(morning, zurich))).toBe('2026-10-26T07:00:00.000Z');
  });

  test('moves a skipped time forward by the gap, and takes the first of a repeated time', () => {
    const skipped = { year: 2026, month: 3, day: 29, hour: 2, minute: 30 };
    expect(iso(instantOf(skipped, zurich))).toBe('2026-03-29T01:30:00.000Z');
    const repeated = { year: 2026, month: 10, day: 25, hour: 2, minute: 30 };
    expect(iso(instantOf(repeated, zurich))).toBe('2026-10-25T00:30:00.000Z');
  });
});

describe('the next run', () => {
  test('of a daily schedule keeps its local time when summer time starts', () => {
    expect(iso(nextRunAt(daily('08:00'), at('2026-03-28T07:00:00Z')))).toBe(
      '2026-03-29T06:00:00.000Z',
    );
    expect(iso(nextRunAt(daily('08:00'), at('2026-03-28T06:59:59Z')))).toBe(
      '2026-03-28T07:00:00.000Z',
    );
  });

  test('of a daily schedule at a skipped time runs once the clock jumps, then as usual', () => {
    const first = nextRunAt(daily('02:30'), at('2026-03-28T01:30:00Z'));
    expect(iso(first)).toBe('2026-03-29T01:30:00.000Z');
    expect(iso(nextRunAt(daily('02:30'), first))).toBe('2026-03-30T00:30:00.000Z');
  });

  test('of a daily schedule at a repeated time runs once, the first time', () => {
    const first = nextRunAt(daily('02:30'), at('2026-10-24T00:30:00Z'));
    expect(iso(first)).toBe('2026-10-25T00:30:00.000Z');
    expect(iso(nextRunAt(daily('02:30'), first))).toBe('2026-10-26T01:30:00.000Z');
  });

  test('of a weekly schedule moves an hour in UTC when summer time ends', () => {
    const mondays: ReportSchedule = {
      every: 'week',
      weekday: 'monday',
      at: '08:00',
      timezone: zurich,
    };
    expect(iso(nextRunAt(mondays, at('2026-10-19T06:00:00Z')))).toBe('2026-10-26T07:00:00.000Z');
    expect(iso(nextRunAt(mondays, at('2026-10-04T12:00:00Z')))).toBe('2026-10-05T06:00:00.000Z');
  });

  test('of a monthly schedule runs on the last day of a shorter month', () => {
    const lastDay: ReportSchedule = { every: 'month', day: 31, at: '08:00', timezone: zurich };
    expect(iso(nextRunAt(lastDay, at('2026-08-31T06:00:00Z')))).toBe('2026-09-30T06:00:00.000Z');
    expect(iso(nextRunAt(lastDay, at('2027-01-31T07:00:00Z')))).toBe('2027-02-28T07:00:00.000Z');
    const first: ReportSchedule = { every: 'month', day: 1, at: '08:00', timezone: zurich };
    expect(iso(nextRunAt(first, at('2026-03-01T07:00:00Z')))).toBe('2026-04-01T06:00:00.000Z');
  });
});

describe('the latest run', () => {
  test('is the last one at or before an instant, for a run owed after downtime', () => {
    const mondays: ReportSchedule = {
      every: 'week',
      weekday: 'monday',
      at: '08:00',
      timezone: zurich,
    };
    expect(iso(latestRunAt(mondays, at('2026-10-04T12:00:00Z')))).toBe('2026-09-28T06:00:00.000Z');
    expect(iso(latestRunAt(mondays, at('2026-09-28T06:00:00Z')))).toBe('2026-09-28T06:00:00.000Z');
    expect(iso(latestRunAt(daily('08:00'), at('2026-03-29T05:59:00Z')))).toBe(
      '2026-03-28T07:00:00.000Z',
    );
  });
});
