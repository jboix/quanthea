/**
 * A report's schedule in words, and the changes the draft pane makes to it by hand: the weekday
 * or the day of the month, the time, the time zone, the period and the comparison. Each change
 * returns a whole new spec, which the server checks like any version.
 */
import {
  isTimeZone,
  type ReportPeriod,
  type ReportSpec,
  reportPeriods,
  type Weekday,
  weekdays,
} from '@quanthea/shared';

/** A schedule. */
type Schedule = ReportSpec['schedule'];

/** What each period covers, in words. */
export const periodWords: Readonly<Record<ReportPeriod, string>> = {
  previous_day: 'the previous day',
  previous_week: 'the previous week',
  previous_month: 'the previous month',
  week_to_date: 'this week so far',
};

/** What each period compares with, in words. */
const comparedWords: Readonly<Record<ReportPeriod, string>> = {
  previous_day: 'the day before',
  previous_week: 'the week before',
  previous_month: 'the month before',
  week_to_date: 'the same days of the week before',
};

/** The periods, in the order the editor offers them. */
export const periodChoices = reportPeriods.map((period) => ({
  value: period,
  label: periodWords[period],
}));

/**
 * A weekday's name.
 *
 * @param weekday - Such as `monday`.
 * @returns Such as `Monday`.
 */
export function weekdayName(weekday: Weekday): string {
  return `${weekday[0]?.toUpperCase() ?? ''}${weekday.slice(1)}`;
}

/** The weekdays, in the order the editor offers them. */
export const weekdayChoices = weekdays.map((weekday) => ({
  value: weekday,
  label: weekdayName(weekday),
}));

/**
 * What a report compares with, in words.
 *
 * @param spec - The spec.
 * @returns Such as `the week before`, or `nothing`.
 */
export function compareWords(spec: Pick<ReportSpec, 'compare' | 'period'>): string {
  return spec.compare === 'none' ? 'nothing' : comparedWords[spec.period];
}

/**
 * The comparison choices of a period.
 *
 * @param period - The period.
 * @returns The period before, or nothing.
 */
export function compareChoices(
  period: ReportPeriod,
): readonly { readonly value: ReportSpec['compare']; readonly label: string }[] {
  return [
    { value: 'previous_period', label: comparedWords[period] },
    { value: 'none', label: 'nothing' },
  ];
}

/**
 * When a schedule runs, before its time: `Every Monday`, `Every day`, `On day 1 of every month`.
 *
 * @param schedule - The schedule.
 * @returns The words.
 */
export function whenWords(schedule: Schedule): string {
  if (schedule.every === 'day') return 'Every day';
  if (schedule.every === 'week') return `Every ${weekdayName(schedule.weekday)}`;
  return `On day ${schedule.day} of every month`;
}

/**
 * The spec with a new schedule.
 *
 * @param spec - The spec.
 * @param schedule - The schedule.
 * @returns The new spec.
 */
function withSchedule(spec: ReportSpec, schedule: Schedule): ReportSpec {
  return { ...spec, schedule };
}

/**
 * The spec run on another weekday; a schedule that is not weekly stays as it is.
 *
 * @param spec - The spec.
 * @param weekday - The weekday.
 * @returns The new spec.
 */
export function withWeekday(spec: ReportSpec, weekday: Weekday): ReportSpec {
  if (spec.schedule.every !== 'week') return spec;
  return withSchedule(spec, { ...spec.schedule, weekday });
}

/**
 * The spec run on another day of the month, or why not.
 *
 * @param spec - The spec.
 * @param text - The day, as typed.
 * @returns The new spec, or what is wrong.
 */
export function withMonthDay(spec: ReportSpec, text: string): ReportSpec | string {
  const day = Number(text.trim());
  if (!Number.isInteger(day) || day < 1 || day > 31) return 'Use a day from 1 to 31.';
  if (spec.schedule.every !== 'month') return spec;
  return withSchedule(spec, { ...spec.schedule, day });
}

/**
 * The spec run at another time of day, or why not.
 *
 * @param spec - The spec.
 * @param text - The time, as typed, such as `8:00` or `08:00`.
 * @returns The new spec, or what is wrong.
 */
export function withTime(spec: ReportSpec, text: string): ReportSpec | string {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(text.trim());
  if (!match) return 'Use a time of day such as 08:00.';
  const at = `${(match[1] ?? '').padStart(2, '0')}:${match[2] ?? '00'}`;
  return withSchedule(spec, { ...spec.schedule, at });
}

/**
 * The spec run on another clock, or why not.
 *
 * @param spec - The spec.
 * @param text - The IANA time zone, as typed.
 * @returns The new spec, or what is wrong.
 */
export function withTimezone(spec: ReportSpec, text: string): ReportSpec | string {
  const timezone = text.trim();
  if (!isTimeZone(timezone)) return 'Use a time zone such as Europe/Zurich.';
  return withSchedule(spec, { ...spec.schedule, timezone });
}

/**
 * The spec covering another period.
 *
 * @param spec - The spec.
 * @param period - The period.
 * @returns The new spec.
 */
export function withPeriod(spec: ReportSpec, period: ReportPeriod): ReportSpec {
  return { ...spec, period };
}

/**
 * The spec comparing with the period before, or with nothing.
 *
 * @param spec - The spec.
 * @param compare - What it compares with.
 * @returns The new spec.
 */
export function withCompare(spec: ReportSpec, compare: ReportSpec['compare']): ReportSpec {
  return { ...spec, compare };
}
