/**
 * Days and times as quanthea writes them: the day before the month, the month's short name from a
 * fixed list, and a 24-hour clock. The list keeps a month the same in every runtime whatever its
 * locale data: newer ICU writes `Sept` for British English, older `Sep`.
 */

/** The months' short names. */
const monthNames = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');

/** An instant's day and time in a time zone, as text. */
export interface CalendarParts {
  /** Such as `2026`. */
  readonly year: string;
  /** Such as `Sep`. */
  readonly month: string;
  /** Such as `5`, without a leading zero. */
  readonly day: string;
  /** Such as `Fri`. */
  readonly weekday: string;
  /** Such as `09:05`. */
  readonly time: string;
}

/**
 * An instant's day and time in a time zone.
 *
 * @param instant - Epoch milliseconds.
 * @param timeZone - An IANA time zone; the runtime's when left out.
 * @returns The year, month, day, weekday and time, as text.
 */
export function calendarParts(instant: number, timeZone?: string): CalendarParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((each) => each.type === type)?.value ?? '';
  return {
    year: part('year'),
    month: monthNames[Number(part('month')) - 1] ?? part('month'),
    day: part('day'),
    weekday: part('weekday'),
    time: `${part('hour')}:${part('minute')}`,
  };
}

/**
 * An instant's day in a time zone.
 *
 * @param instant - Epoch milliseconds.
 * @param timeZone - An IANA time zone; the runtime's when left out.
 * @returns Such as `25 Sep`.
 */
export function dayMonth(instant: number, timeZone?: string): string {
  const { day, month } = calendarParts(instant, timeZone);
  return `${day} ${month}`;
}

/**
 * An instant's day and time of day in a time zone, with the year when it is not the current one.
 *
 * @param instant - Epoch milliseconds.
 * @param now - The current time, for the year.
 * @param timeZone - An IANA time zone; the runtime's when left out.
 * @returns Such as `4 Oct 17:55`, or `28 Dec 2025 09:10` in another year.
 */
export function dayMonthTime(instant: number, now: number, timeZone?: string): string {
  const { day, month, year, time } = calendarParts(instant, timeZone);
  const sameYear = year === calendarParts(now, timeZone).year;
  const yearText = sameYear ? '' : ` ${year}`;
  return `${day} ${month}${yearText} ${time}`;
}

/**
 * An instant's date in a time zone, with the year.
 *
 * @param instant - Epoch milliseconds.
 * @param timeZone - An IANA time zone; the runtime's when left out.
 * @returns Such as `4 Nov 2026`.
 */
export function dayMonthYear(instant: number, timeZone?: string): string {
  const { day, month, year } = calendarParts(instant, timeZone);
  return `${day} ${month} ${year}`;
}

/**
 * An instant's time of day when it is today, else its day and time, in a time zone.
 *
 * @param instant - Epoch milliseconds.
 * @param now - The current time.
 * @param timeZone - An IANA time zone; the runtime's when left out.
 * @returns Such as `14:02`, `28 Sep 14:02`, or `28 Dec 2025 14:02` in another year.
 */
export function timeOrDayTime(instant: number, now: number, timeZone?: string): string {
  const when = calendarParts(instant, timeZone);
  const today = calendarParts(now, timeZone);
  const sameDay = when.year === today.year && when.month === today.month && when.day === today.day;
  return sameDay ? when.time : dayMonthTime(instant, now, timeZone);
}
