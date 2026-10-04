/**
 * When a report runs: every day, every week on a weekday, or every month on a day of the month, at
 * a time of day on the clock of its time zone. A day of the month past the month's end runs on its
 * last day, so `31` runs on 30 September and 28 February. Daylight saving follows `zoned.ts`: a
 * time skipped runs once the clock jumps, a time repeated runs the first time.
 */
import { z } from 'zod';
import {
  addDays,
  type CalendarDate,
  daysInMonth,
  instantOf,
  isoWeekday,
  wallTimeOf,
} from './zoned.ts';

/** The weekdays, Monday first, as a weekly schedule names them. */
export const weekdays = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

/** A weekday. */
export type Weekday = (typeof weekdays)[number];

/** Validates a time of day, `HH:MM` on a 24-hour clock. */
const timeOfDaySchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Use a time of day such as 08:00.');

/** The fields every schedule has: the time of day and the time zone. */
const scheduleBase = {
  /** The time of day, `HH:MM`. */
  at: timeOfDaySchema,
  /** The IANA time zone of the clock it runs on, such as `Europe/Zurich`. */
  timezone: z.string().min(1).max(64),
};

/** Validates a schedule. */
export const reportScheduleSchema = z.discriminatedUnion('every', [
  z.strictObject({ every: z.literal('day'), ...scheduleBase }),
  z.strictObject({ every: z.literal('week'), weekday: z.enum(weekdays), ...scheduleBase }),
  z.strictObject({ every: z.literal('month'), day: z.int().min(1).max(31), ...scheduleBase }),
]);

/** A schedule. */
export type ReportSchedule = z.infer<typeof reportScheduleSchema>;

/** How far the search for a run looks, in days: over two months covers every schedule. */
const searchDays = 64;

/**
 * Whether a schedule runs on a date.
 *
 * @param schedule - The schedule.
 * @param date - The date.
 * @returns `true` when it runs that day.
 */
function runsOn(schedule: ReportSchedule, date: CalendarDate): boolean {
  if (schedule.every === 'day') return true;
  if (schedule.every === 'week') return weekdays[isoWeekday(date) - 1] === schedule.weekday;
  return date.day === Math.min(schedule.day, daysInMonth(date.year, date.month));
}

/**
 * The instant a schedule runs on a date.
 *
 * @param schedule - The schedule.
 * @param date - A date it runs on.
 * @returns Epoch milliseconds.
 */
function runOn(schedule: ReportSchedule, date: CalendarDate): number {
  const [hour = 0, minute = 0] = schedule.at.split(':').map(Number);
  return instantOf({ ...date, hour, minute }, schedule.timezone);
}

/**
 * The instants a schedule runs on, from a date, one way.
 *
 * @param schedule - The schedule.
 * @param from - The date to start from.
 * @param step - 1 to go forward, -1 to go back.
 * @returns The instants, in the order met.
 */
function runsFrom(schedule: ReportSchedule, from: CalendarDate, step: 1 | -1): number[] {
  return Array.from({ length: searchDays }, (_, index) => addDays(from, index * step))
    .filter((date) => runsOn(schedule, date))
    .map((date) => runOn(schedule, date));
}

/**
 * The first time a schedule runs after an instant.
 *
 * @param schedule - The schedule.
 * @param after - The instant, in epoch milliseconds.
 * @returns The first run strictly after it, in epoch milliseconds.
 */
export function nextRunAt(schedule: ReportSchedule, after: number): number {
  const start = addDays(wallTimeOf(after, schedule.timezone), -1);
  return runsFrom(schedule, start, 1).find((instant) => instant > after) ?? Number.NaN;
}

/**
 * The last time a schedule ran at or before an instant: the run a report owes after downtime.
 *
 * @param schedule - The schedule.
 * @param atOrBefore - The instant, in epoch milliseconds.
 * @returns The latest run not after it, in epoch milliseconds.
 */
export function latestRunAt(schedule: ReportSchedule, atOrBefore: number): number {
  const start = addDays(wallTimeOf(atOrBefore, schedule.timezone), 1);
  return runsFrom(schedule, start, -1).find((instant) => instant <= atOrBefore) ?? Number.NaN;
}
