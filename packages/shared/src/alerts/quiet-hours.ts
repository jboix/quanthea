/**
 * Quiet hours: the days and times of day an alert sends nothing, on the clock of a named time
 * zone. The alert is still evaluated and its changes of state are kept. A window that ends at or
 * before the time it starts crosses midnight, and its days name the day it starts on, so Friday
 * 22:00 to 07:00 ends on Saturday morning. The clock is the wall clock: when daylight saving
 * skips an hour the window ends with the jump, and an hour shown twice is quiet both times.
 */
import { z } from 'zod';
import { timeOfDaySchema, weekdays } from '../reports/schedule.ts';
import { addDays, instantOf, isoWeekday, isTimeZone, wallTimeOf } from '../reports/zoned.ts';

/** Validates one quiet window: the days it starts on, and the times it starts and ends. */
const quietWindowSchema = z.strictObject({
  /** The days the window starts on. */
  days: z.array(z.enum(weekdays)).min(1).max(7),
  /** When it starts, `HH:MM`. */
  from: timeOfDaySchema,
  /** When it ends, `HH:MM`; at or before `from`, it ends the next day. The same as `from`: 24h. */
  to: timeOfDaySchema,
});

/** One quiet window. */
type QuietWindow = z.infer<typeof quietWindowSchema>;

/** Validates quiet hours: the windows, and the time zone of their clock. */
export const quietHoursSchema = z.strictObject({
  /** The IANA time zone of the clock, such as `Europe/Zurich`. */
  timezone: z
    .string()
    .min(1)
    .max(64)
    .refine(isTimeZone, 'Use an IANA time zone such as Europe/Zurich.'),
  /** The windows; it is quiet while any of them holds. */
  windows: z.array(quietWindowSchema).min(1).max(8),
});

/** Quiet hours. */
export type QuietHours = z.infer<typeof quietHoursSchema>;

/** Validates an alert's own quiet hours, or `none`: the alert always notifies. */
export const alertQuietHoursSchema = z.union([z.literal('none'), quietHoursSchema]);

/** The quiet hours of every alert that sets none, and the severities they leave alone. */
export interface DefaultQuietHours extends QuietHours {
  /** The severities that notify whatever the hour. */
  readonly exceptSeverities: readonly string[];
}

/**
 * The minutes since midnight of a time of day.
 *
 * @param time - The time, `HH:MM`.
 * @returns 0 to 1439.
 */
function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
}

/**
 * Whether a window holds at a time of a weekday.
 *
 * @param window - The window.
 * @param weekday - The day on the clock, 0 for Monday to 6 for Sunday.
 * @param minute - The minutes since midnight on the clock.
 * @returns `true` inside the window; its end is outside.
 */
function windowHolds(window: QuietWindow, weekday: number, minute: number): boolean {
  const from = minutesOf(window.from);
  const to = minutesOf(window.to);
  const startsOn = (day: number) => window.days.some((name) => name === weekdays[day % 7]);
  if (from < to) return startsOn(weekday) && minute >= from && minute < to;
  return (startsOn(weekday) && minute >= from) || (startsOn(weekday + 6) && minute < to);
}

/**
 * Whether quiet hours hold at an instant.
 *
 * @param quietHours - The quiet hours.
 * @param instant - Epoch milliseconds.
 * @returns `true` while one of the windows holds on the clock of the time zone.
 */
export function isQuietAt(quietHours: QuietHours, instant: number): boolean {
  const wall = wallTimeOf(instant, quietHours.timezone);
  const weekday = isoWeekday(wall) - 1;
  const minute = wall.hour * 60 + wall.minute;
  return quietHours.windows.some((window) => windowHolds(window, weekday, minute));
}

/** How far the search for the next change looks, in days: a week, and a day either side. */
const searchDays = 9;

/** A minute, in milliseconds. */
const minuteMs = 60_000;

/**
 * The instants the clock shows a start or an end of a window, from the day of an instant on.
 *
 * @param quietHours - The quiet hours.
 * @param instant - Epoch milliseconds.
 * @returns The instants after it, the earliest first.
 */
function boundariesAfter(quietHours: QuietHours, instant: number): number[] {
  const today = wallTimeOf(instant, quietHours.timezone);
  const times = new Set(quietHours.windows.flatMap((window) => [window.from, window.to]));
  const instants = Array.from({ length: searchDays }, (_unused, days) =>
    [...times].map((time) => {
      const minutes = minutesOf(time);
      const wall = {
        ...addDays(today, days),
        hour: Math.floor(minutes / 60),
        minute: minutes % 60,
      };
      return instantOf(wall, quietHours.timezone);
    }),
  );
  return instants
    .flat()
    .filter((each) => each > instant)
    .sort((a, b) => a - b);
}

/**
 * The first minute between two instants at which quiet hours are no longer as at the first. The
 * change is at the second unless daylight saving moved it: a window ends with a skipped hour.
 *
 * @param quietHours - The quiet hours.
 * @param same - An instant, on a minute.
 * @param changed - A later instant, at which they differ from the first.
 * @returns Epoch milliseconds.
 */
function firstChange(quietHours: QuietHours, same: number, changed: number): number {
  const quiet = isQuietAt(quietHours, same);
  let low = same;
  let high = changed;
  while (high - low > minuteMs) {
    const middle = low + Math.floor((high - low) / (2 * minuteMs)) * minuteMs;
    if (isQuietAt(quietHours, middle) === quiet) low = middle;
    else high = middle;
  }
  return high;
}

/**
 * When quiet hours next start, or next end: the first instant after one at which they hold when
 * they did not, or no longer hold when they did.
 *
 * @param quietHours - The quiet hours.
 * @param instant - Epoch milliseconds.
 * @returns Epoch milliseconds, on a minute; `null` when they hold every hour of the week.
 */
export function nextQuietChange(quietHours: QuietHours, instant: number): number | null {
  const quiet = isQuietAt(quietHours, instant);
  const boundaries = boundariesAfter(quietHours, instant);
  const index = boundaries.findIndex((each) => isQuietAt(quietHours, each) !== quiet);
  const changed = boundaries[index];
  if (changed === undefined) return null;
  const same = Math.floor(instant / minuteMs) * minuteMs;
  return firstChange(quietHours, Math.max(same, boundaries[index - 1] ?? same), changed);
}

/**
 * The quiet hours an alert keeps: its own, else the default unless its severity is left alone.
 *
 * @param alert - The alert's severity and its own quiet hours, if it sets any.
 * @param defaults - The default of the alert settings, or `null` without one.
 * @returns The quiet hours, or `null` when the alert always notifies.
 */
export function quietHoursOf(
  alert: {
    readonly severity: string;
    readonly quietHours?: QuietHours | 'none' | undefined;
  },
  defaults: DefaultQuietHours | null,
): QuietHours | null {
  if (alert.quietHours === 'none') return null;
  if (alert.quietHours !== undefined) return alert.quietHours;
  if (defaults === null || defaults.exceptSeverities.includes(alert.severity)) return null;
  return defaults;
}
