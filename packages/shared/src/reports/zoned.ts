/**
 * Wall clock time in an IANA time zone, from the platform's `Intl` only. Reports run "every Monday
 * at 8:00" and cover "the previous week" on the clock of their time zone, so the schedule and the
 * periods move between instants and calendar dates here. A local time that does not exist (the
 * hour skipped when daylight saving starts) moves forward by the gap; a local time that happens
 * twice (the hour repeated when it ends) is the first of the two.
 */

/** A calendar date. */
export interface CalendarDate {
  /** Such as 2026. */
  readonly year: number;
  /** 1 to 12. */
  readonly month: number;
  /** 1 to 31. */
  readonly day: number;
}

/** A date and a time of day on a wall clock. */
export interface WallTime extends CalendarDate {
  /** 0 to 23. */
  readonly hour: number;
  /** 0 to 59. */
  readonly minute: number;
}

/** A day, in milliseconds. */
const dayMs = 86_400_000;

/** The formatters already built, by time zone: building one is slow. */
const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * The formatter that reads an instant's wall clock in a time zone.
 *
 * @param timeZone - An IANA time zone.
 * @returns The formatter.
 * @throws {RangeError} For a time zone the platform does not know.
 */
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const known = formatters.get(timeZone);
  if (known) return known;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  formatters.set(timeZone, formatter);
  return formatter;
}

/**
 * Whether the platform knows a time zone.
 *
 * @param timeZone - An IANA name, such as `Europe/Zurich`.
 * @returns `true` when it is known.
 */
export function isTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/**
 * An instant's wall clock in a time zone, to the second, as epoch milliseconds of the same
 * numbers in UTC.
 *
 * @param instant - Epoch milliseconds.
 * @param timeZone - An IANA time zone.
 * @returns The wall clock, read as if it were UTC.
 */
function wallMs(instant: number, timeZone: string): number {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((each) => each.type === type)?.value ?? 0);
  const seconds = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return seconds + (instant - Math.floor(instant / 1000) * 1000);
}

/**
 * An instant's date and time on the wall clock of a time zone.
 *
 * @param instant - Epoch milliseconds.
 * @param timeZone - An IANA time zone.
 * @returns The wall time.
 */
export function wallTimeOf(instant: number, timeZone: string): WallTime {
  const wall = new Date(wallMs(instant, timeZone));
  return {
    year: wall.getUTCFullYear(),
    month: wall.getUTCMonth() + 1,
    day: wall.getUTCDate(),
    hour: wall.getUTCHours(),
    minute: wall.getUTCMinutes(),
  };
}

/**
 * The instant a wall clock in a time zone shows a date and time. A time skipped by daylight
 * saving moves forward by the gap; a time shown twice is the first of the two.
 *
 * @param wall - The date and time on the wall clock.
 * @param timeZone - An IANA time zone.
 * @returns Epoch milliseconds.
 */
export function instantOf(wall: WallTime, timeZone: string): number {
  const target = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  // The offsets a day either side: a zone changes its offset at most once in two days.
  const before = target - (wallMs(target - dayMs, timeZone) - (target - dayMs));
  const after = target - (wallMs(target + dayMs, timeZone) - (target + dayMs));
  const shown = [before, after].filter((instant) => wallMs(instant, timeZone) === target);
  return shown.length > 0 ? Math.min(...shown) : before;
}

/**
 * A date some days away, on the calendar.
 *
 * @param date - The date.
 * @param days - How many days later; negative for earlier.
 * @returns The date.
 */
export function addDays(date: CalendarDate, days: number): CalendarDate {
  const moved = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() };
}

/**
 * The number of days in a month.
 *
 * @param year - The year.
 * @param month - The month, 1 to 12.
 * @returns 28 to 31.
 */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * A date some months away, its day kept or moved to the month's last day.
 *
 * @param date - The date.
 * @param months - How many months later; negative for earlier.
 * @returns The date.
 */
export function addMonths(date: CalendarDate, months: number): CalendarDate {
  const index = date.year * 12 + date.month - 1 + months;
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

/**
 * The ISO weekday of a date.
 *
 * @param date - The date.
 * @returns 1 for Monday to 7 for Sunday.
 */
export function isoWeekday(date: CalendarDate): number {
  const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/**
 * The ISO week number of a date: weeks start on Monday, and week 1 holds the year's first
 * Thursday.
 *
 * @param date - The date.
 * @returns The week, 1 to 53, and the year it belongs to.
 */
export function isoWeek(date: CalendarDate): { readonly week: number; readonly year: number } {
  const thursday = addDays(date, 4 - isoWeekday(date));
  const firstDay = Date.UTC(thursday.year, 0, 1);
  const dayOfYear = (Date.UTC(thursday.year, thursday.month - 1, thursday.day) - firstDay) / dayMs;
  return { week: Math.floor(dayOfYear / 7) + 1, year: thursday.year };
}
