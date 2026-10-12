/**
 * The profile of a number over the clock: its typical value at each hour of the day and on each
 * day of the week, in a time zone, with how far each moved between days. It is made of means over
 * many points, never of a row, and only when the series is long and fine enough to mean something.
 */

import { type Clock, clockOf } from './zone-clock.ts';

/** A number at an hour of the day, across the days of the series. */
export interface HourSlot {
  /** The hour of the day on the zone's clock, 0 to 23. */
  readonly hour: number;
  /** The mean of that hour over the days. */
  readonly mean: number;
  /** The lowest that hour was on one day. */
  readonly min: number;
  /** The highest that hour was on one day. */
  readonly max: number;
}

/** A number on a day of the week, across the weeks of the series. */
export interface WeekdaySlot {
  /** The day of the week, such as `Monday`. */
  readonly weekday: string;
  /** The mean of that weekday's days. */
  readonly mean: number;
  /** The lowest one of those days was. */
  readonly min: number;
  /** The highest one of those days was. */
  readonly max: number;
  /** How many such days the series holds whole. */
  readonly days: number;
}

/** Which hour was the highest of its day, and on how many days. */
export interface PeakHours {
  /** The days compared: the whole days with points in at least half of their hours, not flat. */
  readonly days: number;
  /** The hours that were the highest of a day, the most frequent first. */
  readonly hours: readonly { readonly hour: number; readonly days: number }[];
}

/** The profile of a number over the clock. */
export interface TimeProfile {
  /** The time zone of the hours and weekdays. */
  readonly timeZone: string;
  /** With buckets of an hour or less over three days or more: each hour of the day. */
  readonly byHour?: readonly HourSlot[];
  /** With {@link byHour}, unless every day is flat: which hour was the highest of its day. */
  readonly peakHour?: PeakHours;
  /** With buckets of a day or less over two weeks or more: each day of the week. */
  readonly byWeekday?: readonly WeekdaySlot[];
}

/** A number and its time, epoch milliseconds. */
interface TimedValue {
  /** The number. */
  readonly value: number;
  /** Its time. */
  readonly at: number;
}

/**
 * Profiles the points of one number column; `undefined` when the series is too short or coarse, or
 * when it is several series at once.
 */
export type Profiler = (points: readonly TimedValue[]) => TimeProfile | undefined;

/** An hour, in milliseconds. */
const hourMs = 3_600_000;

/** A day, in milliseconds. */
const dayMs = 24 * hourMs;

/** The shortest series that gets a profile by hour of day. */
const hourlySpan = 3 * dayMs;

/** The shortest series that gets a profile by weekday: each weekday twice. */
const weekdaySpan = 14 * dayMs;

/** How many hours of a day need points for the day to have a highest hour. */
const hoursOfFullDay = 12;

/** The share of a day's buckets that need a point for the day to count among its weekday's. */
const shareOfFullDay = 0.5;

/** How many peak hours a profile lists. */
const peakListLength = 5;

/** The days of the week, in the order a profile lists them. */
const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * Rounds a number to six significant digits, as the summaries do.
 *
 * @param value - The number.
 * @returns The rounded number.
 */
function round(value: number): number {
  return Number(value.toPrecision(6));
}

/** How a series is laid out in time. */
interface Cadence {
  /** The usual distance between two points: the median gap between the distinct times. */
  readonly step: number;
  /** The first time. */
  readonly first: number;
  /** The last time. */
  readonly last: number;
  /** How many distinct times the series has. */
  readonly times: number;
}

/**
 * Reads how a series is laid out in time.
 *
 * @param points - The points.
 * @returns The cadence, or `undefined` under two distinct times.
 */
function cadenceOf(points: readonly TimedValue[]): Cadence | undefined {
  const times = [...new Set(points.map((point) => point.at))].sort((left, right) => left - right);
  const gaps = times.slice(1).map((time, index) => time - (times[index] ?? time));
  const step = gaps.sort((left, right) => left - right)[Math.floor(gaps.length / 2)];
  const first = times[0];
  const last = times.at(-1);
  if (step === undefined || first === undefined || last === undefined) return undefined;
  return { step, first, last, times: times.length };
}

/** The series a profile is made of: its layout in time, and which profiles it is fit for. */
interface Scope extends Cadence {
  /** Whether the hours of the day mean something. */
  readonly hourly: boolean;
  /** Whether the days of the week mean something. */
  readonly weekly: boolean;
}

/**
 * The periods a series starts or ends inside of, such as the day of a series that starts at 15:00.
 * A period is cut when the bucket before the first point, or after the last, falls in it too.
 *
 * @param scope - The layout of the series.
 * @param periodOf - Names the period of an instant.
 * @returns The cut periods: none, the first, the last, or both.
 */
function cutPeriods(scope: Cadence, periodOf: (instant: number) => string): Set<string> {
  const cut = new Set<string>();
  const first = periodOf(scope.first);
  const last = periodOf(scope.last);
  if (periodOf(scope.first - scope.step) === first) cut.add(first);
  if (periodOf(scope.last + scope.step) === last) cut.add(last);
  return cut;
}

/** The mean of some values, and how many they were. */
interface Mean {
  /** The mean. */
  readonly mean: number;
  /** How many values it is the mean of. */
  readonly count: number;
}

/**
 * The mean of the values that share a key.
 *
 * @param entries - Each value with its key.
 * @returns The mean per key, in the order the keys first appear.
 */
function meansByKey(entries: readonly (readonly [string, number])[]): Map<string, Mean> {
  const sums = new Map<string, { sum: number; count: number }>();
  for (const [key, value] of entries) {
    const known = sums.get(key) ?? { sum: 0, count: 0 };
    sums.set(key, { sum: known.sum + value, count: known.count + 1 });
  }
  return new Map([...sums].map(([key, { sum, count }]) => [key, { mean: sum / count, count }]));
}

/**
 * The mean, lowest and highest of some numbers, rounded.
 *
 * @param values - The numbers, at least one.
 * @returns The three.
 */
function spreadOf(values: readonly number[]): { mean: number; min: number; max: number } {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { mean: round(mean), min: round(Math.min(...values)), max: round(Math.max(...values)) };
}

/** The value of one hour of one day. */
interface HourCell {
  /** The local day. */
  readonly day: string;
  /** The local hour. */
  readonly hour: number;
  /** The mean of the points in that hour of that day. */
  readonly value: number;
}

/**
 * The series as one value per hour of each day. An hour the series starts or ends inside of is
 * left out: with buckets under an hour, its mean would be of a part of the hour.
 *
 * @param points - The points.
 * @param clock - The zone's clock.
 * @param scope - The layout of the series.
 * @returns The cells.
 */
function hourCells(points: readonly TimedValue[], clock: Clock, scope: Cadence): HourCell[] {
  const keyOf = (instant: number) => {
    const { day, hour } = clock(instant);
    return `${day} ${hour}`;
  };
  const cut = cutPeriods(scope, keyOf);
  const means = meansByKey(points.map((point) => [keyOf(point.at), point.value] as const));
  return [...means].flatMap(([key, { mean }]) => {
    const [day = '', hour] = key.split(' ');
    return cut.has(key) ? [] : [{ day, hour: Number(hour), value: mean }];
  });
}

/**
 * Each hour of the day across the days.
 *
 * @param cells - One value per hour of each day.
 * @returns The hours that have a value, from midnight on.
 */
function hourSlots(cells: readonly HourCell[]): HourSlot[] {
  return Array.from({ length: 24 }, (_unused, hour) => hour).flatMap((hour) => {
    const values = cells.filter((cell) => cell.hour === hour).map((cell) => cell.value);
    return values.length === 0 ? [] : [{ hour, ...spreadOf(values) }];
  });
}

/**
 * The highest hour of a day.
 *
 * @param hours - The day's hours.
 * @returns The hour, the earlier of a tie; `undefined` for a flat day, where no hour is above
 *   another.
 */
function topHour(hours: readonly HourCell[]): number | undefined {
  const values = hours.map((cell) => cell.value);
  const highest = Math.max(...values);
  if (highest === Math.min(...values)) return undefined;
  return hours.find((cell) => cell.value === highest)?.hour;
}

/**
 * Which hour was the highest of its day, counted over the whole days with points in enough hours.
 * A flat day has no highest hour and is not compared.
 *
 * @param cells - One value per hour of each day.
 * @param cutDays - The days the series starts or ends inside of, which have no highest hour.
 * @returns The days compared and the hours, the most frequent first; `undefined` when no day is
 *   left to compare, as for a series that never moves.
 */
function peakHours(
  cells: readonly HourCell[],
  cutDays: ReadonlySet<string>,
): PeakHours | undefined {
  const byDay = new Map<string, HourCell[]>();
  for (const cell of cells) byDay.set(cell.day, [...(byDay.get(cell.day) ?? []), cell]);
  const tops = [...byDay]
    .filter(([day, hours]) => !cutDays.has(day) && hours.length >= hoursOfFullDay)
    .flatMap(([, hours]) => topHour(hours) ?? []);
  if (tops.length === 0) return undefined;
  const counts = new Map<number, number>();
  for (const hour of tops) counts.set(hour, (counts.get(hour) ?? 0) + 1);
  const hours = [...counts]
    .map(([hour, days]) => ({ hour, days }))
    .sort((left, right) => right.days - left.days || left.hour - right.hour)
    .slice(0, peakListLength);
  return { days: tops.length, hours };
}

/**
 * The profile by hour of day.
 *
 * @param points - The points.
 * @param clock - The zone's clock.
 * @param scope - The layout of the series.
 * @returns The hours and, unless every day is flat, the highest hours; empty when no hour is left.
 */
function hourProfile(
  points: readonly TimedValue[],
  clock: Clock,
  scope: Cadence,
): Pick<TimeProfile, 'byHour' | 'peakHour'> {
  const cells = hourCells(points, clock, scope);
  if (cells.length === 0) return {};
  const cutDays = cutPeriods(scope, (instant) => clock(instant).day);
  const peakHour = peakHours(cells, cutDays);
  return { byHour: hourSlots(cells), ...(peakHour ? { peakHour } : {}) };
}

/** The value of one whole day. */
interface DayValue {
  /** The local day of the week. */
  readonly weekday: string;
  /** The mean of the day's points. */
  readonly value: number;
}

/**
 * The series as one value per whole day. A point belongs to the day the middle of its bucket falls
 * on, so a daily bucket cut at midnight in another zone keeps its day. A day the series starts or
 * ends inside of is left out, and so is one with points in under half of its buckets: its mean
 * would be of a part of the day.
 *
 * @param points - The points.
 * @param clock - The zone's clock.
 * @param scope - The layout of the series.
 * @returns The whole days.
 */
function wholeDays(points: readonly TimedValue[], clock: Clock, scope: Cadence): DayValue[] {
  const timeOf = (instant: number) => clock(instant + Math.floor(scope.step / 2));
  const cut = cutPeriods(scope, (instant) => timeOf(instant).day);
  const weekdayOf = new Map<string, string>();
  const days = meansByKey(
    points.map((point) => {
      const { day, weekday } = timeOf(point.at);
      weekdayOf.set(day, weekday);
      return [day, point.value] as const;
    }),
  );
  const fewest = (dayMs / scope.step) * shareOfFullDay;
  return [...days].flatMap(([day, { mean, count }]) =>
    cut.has(day) || count < fewest ? [] : [{ weekday: weekdayOf.get(day) ?? '', value: mean }],
  );
}

/**
 * The profile by day of the week: each weekday across the weeks, over the whole days.
 *
 * @param points - The points.
 * @param clock - The zone's clock.
 * @param scope - The layout of the series.
 * @returns The weekdays that have a whole day, from Monday on; empty when none has.
 */
function weekdayProfile(
  points: readonly TimedValue[],
  clock: Clock,
  scope: Cadence,
): Pick<TimeProfile, 'byWeekday'> {
  const days = wholeDays(points, clock, scope);
  const byWeekday = weekdays.flatMap((weekday) => {
    const values = days.filter((day) => day.weekday === weekday).map((day) => day.value);
    return values.length === 0 ? [] : [{ weekday, ...spreadOf(values), days: values.length }];
  });
  return byWeekday.length === 0 ? {} : { byWeekday };
}

/**
 * Which profiles a series is long and fine enough for.
 *
 * Points that share a time are several series in one frame, such as a count per country and hour.
 * They get no profile: a series with no point in an hour may be zero there or unknown, so neither
 * their sum nor their mean is the measure.
 *
 * @param points - The points.
 * @returns The layout of the series, and whether the hours and the weekdays mean something;
 *   `undefined` when neither does.
 */
function scopeOf(points: readonly TimedValue[]): Scope | undefined {
  const cadence = cadenceOf(points);
  if (!cadence || cadence.times < points.length) return undefined;
  const span = cadence.last - cadence.first + cadence.step;
  const hourly = cadence.step <= hourMs && span >= hourlySpan;
  const weekly = cadence.step <= dayMs && span >= weekdaySpan;
  return hourly || weekly ? { ...cadence, hourly, weekly } : undefined;
}

/**
 * The profiler of a time zone, for the number columns of one frame.
 *
 * A profile by hour of day needs buckets of an hour or less over three days; one by weekday needs
 * buckets of a day or less over two weeks. Both need one point per time. A series with neither
 * gets no profile.
 *
 * @param timeZone - An IANA time zone.
 * @returns The profiler, or `undefined` for an unknown zone.
 */
export function profilerOf(timeZone: string): Profiler | undefined {
  const clock = clockOf(timeZone);
  if (!clock) return undefined;
  return (points) => {
    const scope = scopeOf(points);
    if (!scope) return undefined;
    const hours = scope.hourly ? hourProfile(points, clock, scope) : {};
    const days = scope.weekly ? weekdayProfile(points, clock, scope) : {};
    const profile = { ...hours, ...days };
    return Object.keys(profile).length === 0 ? undefined : { timeZone, ...profile };
  };
}
