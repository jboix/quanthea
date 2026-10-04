/**
 * The window a report run covers, resolved on the clock of the report's time zone at the time the
 * run is due. Weeks are ISO weeks, Monday to Sunday. A period runs from its first instant to the
 * last millisecond before the next period starts, so a query that keeps both ends never counts a
 * row twice across two runs. The comparison period is the one before, as the same rule gives it
 * one day, week or month earlier.
 */
import { z } from 'zod';
import {
  addDays,
  addMonths,
  type CalendarDate,
  instantOf,
  isoWeek,
  isoWeekday,
  type WallTime,
  wallTimeOf,
} from './zoned.ts';

/**
 * The periods a report covers:
 * - `previous_day`: yesterday, midnight to midnight;
 * - `previous_week`: the previous ISO week, Monday to Sunday;
 * - `previous_month`: the previous calendar month;
 * - `week_to_date`: this ISO week, from Monday's midnight to the run.
 */
export const reportPeriods = [
  'previous_day',
  'previous_week',
  'previous_month',
  'week_to_date',
] as const;

/** Validates a period kind. */
export const reportPeriodSchema = z.enum(reportPeriods);

/** A period kind. */
export type ReportPeriod = z.infer<typeof reportPeriodSchema>;

/** A resolved window, in epoch milliseconds, both ends included. */
export interface PeriodRange {
  /** The first instant. */
  readonly from: number;
  /** The last instant. */
  readonly to: number;
}

/** The months' names. */
const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** The weekdays' short names, Monday first. */
const weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/**
 * Midnight of a date, on the clock of a time zone.
 *
 * @param date - The date.
 * @param timeZone - The time zone.
 * @returns Epoch milliseconds.
 */
function midnight(date: CalendarDate, timeZone: string): number {
  return instantOf({ ...date, hour: 0, minute: 0 }, timeZone);
}

/**
 * The first and the following day of a period, as dates: the period runs from the first to the
 * day before the following one.
 *
 * @param kind - The period kind.
 * @param today - The date the run is due on.
 * @returns The first day and the day after the last.
 */
function boundaries(kind: ReportPeriod, today: CalendarDate) {
  const monday = addDays(today, 1 - isoWeekday(today));
  if (kind === 'previous_day') return { first: addDays(today, -1), next: today };
  if (kind === 'previous_week') return { first: addDays(monday, -7), next: monday };
  if (kind === 'week_to_date') return { first: monday, next: addDays(monday, 7) };
  const firstOfMonth = { ...today, day: 1 };
  return { first: addMonths(firstOfMonth, -1), next: firstOfMonth };
}

/**
 * Resolves a period at the time a run is due.
 *
 * @param kind - The period kind.
 * @param at - When the run is due, in epoch milliseconds.
 * @param timeZone - The report's time zone.
 * @returns The window. `week_to_date` ends at `at`.
 */
export function resolvePeriod(kind: ReportPeriod, at: number, timeZone: string): PeriodRange {
  const { first, next } = boundaries(kind, wallTimeOf(at, timeZone));
  const from = midnight(first, timeZone);
  if (kind === 'week_to_date') return { from, to: at };
  return { from, to: midnight(next, timeZone) - 1 };
}

/**
 * The same wall clock time one period earlier: a day, a week or a month before.
 *
 * @param kind - The period kind.
 * @param wall - The wall time.
 * @returns The earlier wall time.
 */
function periodEarlier(kind: ReportPeriod, wall: WallTime): WallTime {
  if (kind === 'previous_day') return { ...wall, ...addDays(wall, -1) };
  if (kind === 'previous_month') return { ...wall, ...addMonths(wall, -1) };
  return { ...wall, ...addDays(wall, -7) };
}

/**
 * The period a run compares with: the period before, as a run due one period earlier covers it.
 *
 * @param kind - The period kind.
 * @param at - When the run is due, in epoch milliseconds.
 * @param timeZone - The report's time zone.
 * @returns The window before.
 */
export function comparisonPeriod(kind: ReportPeriod, at: number, timeZone: string): PeriodRange {
  const earlier = instantOf(periodEarlier(kind, wallTimeOf(at, timeZone)), timeZone);
  return resolvePeriod(kind, earlier, timeZone);
}

/**
 * A date in words, such as `29 Sep`, with the year when asked.
 *
 * @param date - The date.
 * @param withYear - Whether to add the year.
 * @returns The words.
 */
function dayMonthOf(date: CalendarDate, withYear: boolean): string {
  const month = (monthNames[date.month - 1] ?? '').slice(0, 3);
  return `${date.day} ${month}${withYear ? ` ${date.year}` : ''}`;
}

/**
 * Two dates as a range: `6 – 12 Oct` within a month, `29 Sep – 5 Oct` across two, and with the
 * years across two years.
 *
 * @param first - The first day.
 * @param last - The last day.
 * @returns The range.
 */
function dayRange(first: CalendarDate, last: CalendarDate): string {
  const years = first.year !== last.year;
  if (!years && first.month === last.month) return `${first.day} – ${dayMonthOf(last, false)}`;
  return `${dayMonthOf(first, years)} – ${dayMonthOf(last, years)}`;
}

/**
 * Names a period as people read it: `Sat 4 Oct`, `week 40, 29 Sep – 5 Oct`, `September 2026`, or
 * `week 41 so far, to Fri 9 Oct 17:00`.
 *
 * @param kind - The period kind.
 * @param period - The window.
 * @param timeZone - The report's time zone.
 * @returns The name.
 */
export function periodLabel(kind: ReportPeriod, period: PeriodRange, timeZone: string): string {
  const first = wallTimeOf(period.from, timeZone);
  const last = wallTimeOf(period.to, timeZone);
  const weekday = (date: CalendarDate) => weekdayNames[isoWeekday(date) - 1];
  if (kind === 'previous_day') return `${weekday(first)} ${dayMonthOf(first, false)}`;
  if (kind === 'previous_month') return `${monthNames[first.month - 1]} ${first.year}`;
  const { week } = isoWeek(first);
  if (kind === 'week_to_date') {
    const time = `${String(last.hour).padStart(2, '0')}:${String(last.minute).padStart(2, '0')}`;
    return `week ${week} so far, to ${weekday(last)} ${dayMonthOf(last, false)} ${time}`;
  }
  return `week ${week}, ${dayRange(first, last)}`;
}
