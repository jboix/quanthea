/**
 * The profile of a number over the clock: its typical value at each hour of the day and on each
 * day of the week, in a time zone, with how far each moved between days. It is made of means over
 * many points, never of a row, and only when the series is long and fine enough to mean something.
 */

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
  /** How many such days the series holds. */
  readonly days: number;
}

/** Which hour was the highest of its day, and on how many days. */
export interface PeakHours {
  /** The days compared: those with points in at least half of their hours. */
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
  /** With {@link byHour}: which hour was the highest of its day. */
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

/** Profiles the points of one number column; `undefined` when the series is too short or coarse. */
export type Profiler = (points: readonly TimedValue[]) => TimeProfile | undefined;

/** Where an instant falls on a zone's clock. */
interface ClockTime {
  /** The local day, such as `2026-10-05`. */
  readonly day: string;
  /** The local hour, 0 to 23. */
  readonly hour: number;
  /** The local day of the week, such as `Monday`. */
  readonly weekday: string;
}

/** Reads an instant on a zone's clock. */
type Clock = (instant: number) => ClockTime;

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

/**
 * The clock of a time zone. It remembers the instants it has read, since the number columns of a
 * frame share their times.
 *
 * @param timeZone - An IANA time zone.
 * @returns The clock, or `undefined` for an unknown zone.
 */
function clockOf(timeZone: string): Clock | undefined {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      weekday: 'long',
    });
  } catch {
    return undefined;
  }
  const read = new Map<number, ClockTime>();
  return (instant) => {
    const known = read.get(instant);
    if (known) return known;
    const parts = Object.fromEntries(
      format.formatToParts(instant).map((part) => [part.type, part.value]),
    );
    const day = `${parts.year}-${parts.month}-${parts.day}`;
    const time = { day, hour: Number(parts.hour), weekday: parts.weekday ?? '' };
    read.set(instant, time);
    return time;
  };
}

/**
 * The usual distance between two points of a series: the median gap between its distinct times.
 *
 * @param points - The points.
 * @returns The step and the span from the first time to the last, or `undefined` under two times.
 */
function cadenceOf(points: readonly TimedValue[]): { step: number; span: number } | undefined {
  const times = [...new Set(points.map((point) => point.at))].sort((left, right) => left - right);
  const gaps = times.slice(1).map((time, index) => time - (times[index] ?? time));
  const step = gaps.sort((left, right) => left - right)[Math.floor(gaps.length / 2)];
  const first = times[0];
  const last = times.at(-1);
  if (step === undefined || first === undefined || last === undefined) return undefined;
  return { step, span: last - first + step };
}

/**
 * The mean of the values that share a key.
 *
 * @param entries - Each value with its key.
 * @returns The mean per key, in the order the keys first appear.
 */
function meansByKey(entries: readonly (readonly [string, number])[]): Map<string, number> {
  const sums = new Map<string, { sum: number; count: number }>();
  for (const [key, value] of entries) {
    const known = sums.get(key) ?? { sum: 0, count: 0 };
    sums.set(key, { sum: known.sum + value, count: known.count + 1 });
  }
  return new Map([...sums].map(([key, { sum, count }]) => [key, sum / count]));
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
 * The series as one value per hour of each day.
 *
 * @param points - The points.
 * @param clock - The zone's clock.
 * @returns The cells.
 */
function hourCells(points: readonly TimedValue[], clock: Clock): HourCell[] {
  const means = meansByKey(
    points.map((point) => {
      const { day, hour } = clock(point.at);
      return [`${day} ${hour}`, point.value] as const;
    }),
  );
  return [...means].map(([key, value]) => {
    const [day = '', hour] = key.split(' ');
    return { day, hour: Number(hour), value };
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
 * Which hour was the highest of its day, counted over the days with points in enough hours. A tie
 * goes to the earlier hour.
 *
 * @param cells - One value per hour of each day.
 * @returns The days compared and the hours, the most frequent first.
 */
function peakHours(cells: readonly HourCell[]): PeakHours {
  const byDay = new Map<string, HourCell[]>();
  for (const cell of cells) byDay.set(cell.day, [...(byDay.get(cell.day) ?? []), cell]);
  const fullDays = [...byDay.values()].filter((day) => day.length >= hoursOfFullDay);
  const counts = new Map<number, number>();
  for (const day of fullDays) {
    const top = day.reduce((best, cell) => (cell.value > best.value ? cell : best));
    counts.set(top.hour, (counts.get(top.hour) ?? 0) + 1);
  }
  const hours = [...counts]
    .map(([hour, days]) => ({ hour, days }))
    .sort((left, right) => right.days - left.days || left.hour - right.hour)
    .slice(0, peakListLength);
  return { days: fullDays.length, hours };
}

/**
 * Each day of the week across the weeks. A point belongs to the day the middle of its bucket
 * falls on, so a daily bucket cut at midnight in another zone keeps its day.
 *
 * @param points - The points.
 * @param clock - The zone's clock.
 * @param step - The usual distance between two points.
 * @returns The weekdays that have a value, from Monday on.
 */
function weekdaySlots(points: readonly TimedValue[], clock: Clock, step: number): WeekdaySlot[] {
  const weekdayOf = new Map<string, string>();
  const days = meansByKey(
    points.map((point) => {
      const { day, weekday } = clock(point.at + Math.floor(step / 2));
      weekdayOf.set(day, weekday);
      return [day, point.value] as const;
    }),
  );
  return weekdays.flatMap((weekday) => {
    const values = [...days].flatMap(([day, value]) =>
      weekdayOf.get(day) === weekday ? [value] : [],
    );
    return values.length === 0 ? [] : [{ weekday, ...spreadOf(values), days: values.length }];
  });
}

/**
 * Which profiles a series is long and fine enough for.
 *
 * @param points - The points.
 * @returns The step, and whether the hours and the weekdays mean something; `undefined` when
 *   neither does.
 */
function scopeOf(
  points: readonly TimedValue[],
): { step: number; hourly: boolean; weekly: boolean } | undefined {
  const cadence = cadenceOf(points);
  if (!cadence) return undefined;
  const hourly = cadence.step <= hourMs && cadence.span >= hourlySpan;
  const weekly = cadence.step <= dayMs && cadence.span >= weekdaySpan;
  return hourly || weekly ? { step: cadence.step, hourly, weekly } : undefined;
}

/**
 * The profiler of a time zone, for the number columns of one frame.
 *
 * A profile by hour of day needs buckets of an hour or less over three days; one by weekday needs
 * buckets of a day or less over two weeks. A series with neither gets no profile.
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
    const cells = scope.hourly ? hourCells(points, clock) : [];
    const hours = scope.hourly ? { byHour: hourSlots(cells), peakHour: peakHours(cells) } : {};
    const days = scope.weekly ? { byWeekday: weekdaySlots(points, clock, scope.step) } : {};
    return { timeZone, ...hours, ...days };
  };
}
