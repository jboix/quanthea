/**
 * How an alert's quiet hours read: which ones it keeps (its own, the default for all alerts, or
 * none), whether they hold now, and when it may next notify or next goes quiet. The draft pane
 * and the alert's page say the same words.
 */
import {
  type AlertSpec,
  calendarParts,
  type DefaultQuietHours,
  isQuietAt,
  nextQuietChange,
  type QuietHours,
  quietHoursOf,
  type Weekday,
  weekdays,
} from '@quanthea/shared';

/** The short name of each weekday. */
const dayNames: Readonly<Record<Weekday, string>> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun',
};

/**
 * The days of a window in words.
 *
 * @param days - The days it starts on, in any order.
 * @returns Such as `every day`, `Mon to Fri`, `Sat and Sun` or `Mon, Wed and Fri`.
 */
export function daysWords(days: readonly Weekday[]): string {
  const ordered = weekdays.filter((day) => days.includes(day));
  if (ordered.length === weekdays.length) return 'every day';
  const names = ordered.map((day) => dayNames[day]);
  const span =
    weekdays.indexOf(ordered.at(-1) ?? 'monday') - weekdays.indexOf(ordered[0] ?? 'monday');
  if (names.length >= 3 && span === names.length - 1) return `${names[0]} to ${names.at(-1)}`;
  if (names.length < 2) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * Quiet hours in words: each window's days and times, then the time zone of their clock.
 *
 * @param quietHours - The quiet hours.
 * @returns Such as `Mon to Fri 22:00 to 07:00; Sat and Sun all day (Europe/Zurich)`.
 */
export function quietHoursWords(quietHours: QuietHours): string {
  const windows = quietHours.windows.map((window) => {
    const times = window.from === window.to ? 'all day' : `${window.from} to ${window.to}`;
    return `${daysWords(window.days)} ${times}`;
  });
  return `${windows.join('; ')} (${quietHours.timezone})`;
}

/** What an alert's quiet hours say now. */
export interface QuietSummary {
  /** Which quiet hours it keeps, or that it keeps none. */
  readonly schedule: string;
  /** Whether they hold now. */
  readonly quiet: boolean;
  /** Whether they hold now and when that changes, in words; empty without quiet hours. */
  readonly status: string;
  /** When they end, while they hold and have an end. */
  readonly quietUntil: number | null;
}

/**
 * A time within the coming week, short, on the browser's clock.
 *
 * @param at - The time.
 * @param now - The current time.
 * @returns The clock today, such as `07:00`, else with the weekday, such as `Mon 07:00`.
 */
function whenWords(at: number, now: number): string {
  const when = calendarParts(at);
  const today = calendarParts(now);
  const sameDay = when.day === today.day && when.month === today.month;
  return sameDay ? when.time : `${when.weekday} ${when.time}`;
}

/**
 * Why an alert keeps no quiet hours.
 *
 * @param spec - The alert's severity and its own quiet hours.
 * @param defaults - The default for all alerts, or `null`.
 * @returns The sentence.
 */
function noneWords(
  spec: Pick<AlertSpec, 'severity' | 'quietHours'>,
  defaults: DefaultQuietHours | null,
): string {
  if (defaults === null) return 'No quiet hours: it notifies at any hour.';
  if (spec.quietHours === 'none')
    return 'No quiet hours: it notifies at any hour, whatever the default.';
  return `No quiet hours: the default leaves ${spec.severity} alerts alone.`;
}

/**
 * Whether quiet hours hold now, and when that changes.
 *
 * @param quietHours - The quiet hours.
 * @param now - The current time.
 * @returns Whether they hold, the sentence, and when they end while they hold.
 */
function statusOf(quietHours: QuietHours, now: number): Omit<QuietSummary, 'schedule'> {
  const change = nextQuietChange(quietHours, now);
  const quiet = isQuietAt(quietHours, now);
  if (change === null)
    return { quiet, status: 'Quiet at every hour: it never notifies.', quietUntil: null };
  if (!quiet)
    return { quiet, status: `Next quiet from ${whenWords(change, now)}.`, quietUntil: null };
  const status = `Quiet now. It may next notify ${whenWords(change, now)}.`;
  return { quiet, status, quietUntil: change };
}

/**
 * What an alert's quiet hours say now.
 *
 * @param spec - The alert's severity and its own quiet hours, if it sets any.
 * @param defaults - The default for all alerts, or `null` without one.
 * @param now - The current time.
 * @returns Which quiet hours it keeps, and whether they hold.
 */
export function quietSummary(
  spec: Pick<AlertSpec, 'severity' | 'quietHours'>,
  defaults: DefaultQuietHours | null,
  now: number,
): QuietSummary {
  const quietHours = quietHoursOf(spec, defaults);
  if (quietHours === null)
    return { schedule: noneWords(spec, defaults), quiet: false, status: '', quietUntil: null };
  const whose = spec.quietHours === undefined ? ', the default for all alerts' : '';
  const schedule = `Quiet ${quietHoursWords(quietHours)}${whose}.`;
  return { schedule, ...statusOf(quietHours, now) };
}
