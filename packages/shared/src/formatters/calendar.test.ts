import { expect, test } from 'bun:test';
import { calendarParts, dayMonth, dayMonthTime, dayMonthYear, timeOrDayTime } from './calendar.ts';

test('writes the month from a fixed list, never the locale data’s Sept', () => {
  const at = Date.UTC(2026, 8, 25, 21, 5);
  expect(dayMonth(at, 'UTC')).toBe('25 Sep');
  expect(calendarParts(at, 'UTC')).toEqual({
    year: '2026',
    month: 'Sep',
    day: '25',
    weekday: 'Fri',
    time: '21:05',
  });
});

test('reads the day and time in the time zone, on a 24-hour clock', () => {
  const at = Date.UTC(2026, 8, 25, 23, 0);
  expect(dayMonth(at, 'Europe/Madrid')).toBe('26 Sep');
  expect(calendarParts(at, 'Europe/Madrid').time).toBe('01:00');
  expect(calendarParts(Date.UTC(2026, 0, 1, 0, 0), 'UTC').time).toBe('00:00');
});

test('writes a day and time, with the year only when it is not the current one', () => {
  const at = Date.UTC(2026, 9, 4, 17, 55);
  expect(dayMonthTime(at, Date.UTC(2026, 11, 1), 'UTC')).toBe('4 Oct 17:55');
  expect(dayMonthTime(at, Date.UTC(2027, 0, 2), 'UTC')).toBe('4 Oct 2026 17:55');
  expect(dayMonthYear(at, 'UTC')).toBe('4 Oct 2026');
});

test('writes only the time for today, else the day and time', () => {
  const now = Date.UTC(2026, 9, 4, 18, 0);
  expect(timeOrDayTime(Date.UTC(2026, 9, 4, 9, 5), now, 'UTC')).toBe('09:05');
  expect(timeOrDayTime(Date.UTC(2026, 8, 28, 14, 2), now, 'UTC')).toBe('28 Sep 14:02');
});
