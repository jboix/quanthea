import { describe, expect, test } from 'bun:test';
import { type ReportSpec, reportSpecSchema } from '@quanthea/shared';
import {
  compareWords,
  whenWords,
  withCompare,
  withMonthDay,
  withPeriod,
  withTime,
  withTimezone,
  withWeekday,
} from './schedule.ts';

/** A weekly report. */
const weekly: ReportSpec = reportSpecSchema.parse({
  specVersion: 1,
  title: 'Weekly sales',
  variables: [],
  panels: [],
  schedule: { every: 'week', weekday: 'monday', at: '08:00', timezone: 'Europe/Zurich' },
  period: 'previous_week',
});

describe('a report’s schedule in the draft pane', () => {
  test('reads as words', () => {
    expect(whenWords(weekly.schedule)).toBe('Every Monday');
    expect(whenWords({ every: 'day', at: '07:00', timezone: 'UTC' })).toBe('Every day');
    expect(whenWords({ every: 'month', day: 1, at: '07:00', timezone: 'UTC' })).toBe(
      'On day 1 of every month',
    );
    expect(compareWords(weekly)).toBe('the week before');
    expect(compareWords({ ...weekly, compare: 'none' })).toBe('nothing');
  });

  test('changes one value by hand, and refuses one that does not read', () => {
    expect(withWeekday(weekly, 'friday').schedule).toMatchObject({ weekday: 'friday' });
    expect(withTime(weekly, '9:30')).toMatchObject({ schedule: { at: '09:30' } });
    expect(withTime(weekly, '25:00')).toBe('Use a time of day such as 08:00.');
    expect(withTimezone(weekly, 'America/New_York')).toMatchObject({
      schedule: { timezone: 'America/New_York' },
    });
    expect(withTimezone(weekly, 'Mars/Olympus')).toBe('Use a time zone such as Europe/Zurich.');
    expect(withMonthDay(weekly, '40')).toBe('Use a day from 1 to 31.');
    expect(withPeriod(weekly, 'week_to_date').period).toBe('week_to_date');
    expect(withCompare(weekly, 'none').compare).toBe('none');
  });
});
