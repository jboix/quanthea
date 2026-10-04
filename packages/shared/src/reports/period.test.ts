import { describe, expect, test } from 'bun:test';
import {
  comparisonPeriod,
  type PeriodRange,
  periodLabel,
  type ReportPeriod,
  resolvePeriod,
} from './period.ts';

/** Zurich: summer time starts on 29 March 2026 and ends on 25 October 2026. */
const zurich = 'Europe/Zurich';

/**
 * A period as ISO texts in UTC.
 *
 * @param range - The period.
 * @returns Its ends.
 */
const iso = (range: PeriodRange) => [
  new Date(range.from).toISOString(),
  new Date(range.to).toISOString(),
];

/**
 * Resolves a period, its comparison and its name at an instant in Zurich.
 *
 * @param kind - The period kind.
 * @param when - The instant, as ISO text.
 * @returns The period, the comparison, as ISO texts, and the name.
 */
function resolved(kind: ReportPeriod, when: string) {
  const at = Date.parse(when);
  const period = resolvePeriod(kind, at, zurich);
  const comparison = comparisonPeriod(kind, at, zurich);
  return {
    period: iso(period),
    comparison: iso(comparison),
    label: periodLabel(kind, period, zurich),
  };
}

describe('the previous week', () => {
  test('runs Monday to Sunday on the report clock', () => {
    expect(resolved('previous_week', '2025-10-06T06:00:00Z')).toEqual({
      period: ['2025-09-28T22:00:00.000Z', '2025-10-05T21:59:59.999Z'],
      comparison: ['2025-09-21T22:00:00.000Z', '2025-09-28T21:59:59.999Z'],
      label: 'week 40, 29 Sep – 5 Oct',
    });
  });

  test('across a year boundary is week 1 of the year its Thursday falls in', () => {
    expect(resolved('previous_week', '2026-01-05T07:00:00Z')).toEqual({
      period: ['2025-12-28T23:00:00.000Z', '2026-01-04T22:59:59.999Z'],
      comparison: ['2025-12-21T23:00:00.000Z', '2025-12-28T22:59:59.999Z'],
      label: 'week 1, 29 Dec 2025 – 4 Jan 2026',
    });
  });

  test('that holds the end of summer time is an hour longer', () => {
    const { period } = resolved('previous_week', '2026-10-26T07:00:00Z');
    expect(period).toEqual(['2026-10-18T22:00:00.000Z', '2026-10-25T22:59:59.999Z']);
  });
});

describe('the previous month', () => {
  test('is the calendar month before, compared with the one before it', () => {
    expect(resolved('previous_month', '2026-11-01T07:00:00Z')).toEqual({
      period: ['2026-09-30T22:00:00.000Z', '2026-10-31T22:59:59.999Z'],
      comparison: ['2026-08-31T22:00:00.000Z', '2026-09-30T21:59:59.999Z'],
      label: 'October 2026',
    });
  });

  test('from the last day of a long month is the month before, and compares with the one before', () => {
    const { period, comparison, label } = resolved('previous_month', '2026-03-31T06:00:00Z');
    expect(label).toBe('February 2026');
    expect(period).toEqual(['2026-01-31T23:00:00.000Z', '2026-02-28T22:59:59.999Z']);
    expect(comparison[0]).toBe('2025-12-31T23:00:00.000Z');
  });
});

describe('the previous day and the week so far', () => {
  test('a day is midnight to midnight, 23 hours when summer time starts', () => {
    expect(resolved('previous_day', '2026-03-30T06:00:00Z')).toEqual({
      period: ['2026-03-28T23:00:00.000Z', '2026-03-29T21:59:59.999Z'],
      comparison: ['2026-03-27T23:00:00.000Z', '2026-03-28T22:59:59.999Z'],
      label: 'Sun 29 Mar',
    });
  });

  test('the week so far runs from Monday to the run, compared with as much of the week before', () => {
    expect(resolved('week_to_date', '2026-10-09T15:00:00Z')).toEqual({
      period: ['2026-10-04T22:00:00.000Z', '2026-10-09T15:00:00.000Z'],
      comparison: ['2026-09-27T22:00:00.000Z', '2026-10-02T15:00:00.000Z'],
      label: 'week 41 so far, to Fri 9 Oct 17:00',
    });
  });
});
