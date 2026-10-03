/**
 * Level 3 summaries of a result: per field counts, ranges, means, spikes and top values, and, when
 * the result has a time column, when each number was lowest and highest and when it spiked. A
 * summary never holds a row.
 */
import type { Field, Frame } from '@quanthea/shared';

/** A time window in which a number stayed above its spike threshold. */
export interface SpikeWindow {
  /** The first point above the threshold, ISO 8601. */
  readonly from: string;
  /** The last consecutive point above it, ISO 8601. */
  readonly to: string;
  /** The highest value in the window. */
  readonly peak: number;
}

/** A summary of one field. */
export type FieldSummary =
  | {
      readonly field: string;
      readonly type: 'number';
      readonly count: number;
      readonly nulls: number;
      readonly min?: number;
      readonly max?: number;
      readonly mean?: number;
      /** Values above the mean by more than three standard deviations, largest first. */
      readonly spikes: readonly { readonly value: number; readonly at?: string }[];
      /** With a time column: when the minimum was first reached, ISO 8601. */
      readonly minAt?: string;
      /** With a time column: when the maximum was first reached, ISO 8601. */
      readonly maxAt?: string;
      /** With a time column: consecutive points above the spike threshold, merged, by time. */
      readonly spikeWindows?: readonly SpikeWindow[];
    }
  | {
      readonly field: string;
      readonly type: 'string';
      readonly count: number;
      readonly nulls: number;
      readonly distinct: number;
      /** The most frequent values and their counts. */
      readonly top: readonly { readonly value: string; readonly count: number }[];
    }
  | {
      readonly field: string;
      readonly type: 'time';
      readonly count: number;
      readonly nulls: number;
      readonly from?: string;
      readonly to?: string;
    }
  | {
      readonly field: string;
      readonly type: 'boolean';
      readonly count: number;
      readonly nulls: number;
      readonly true: number;
    };

/** How many spikes and top values a summary lists. */
const listLength = 5;

/**
 * Rounds a number to six significant digits, which is plenty for a summary.
 *
 * @param value - The number.
 * @returns The rounded number.
 */
function round(value: number): number {
  return Number(value.toPrecision(6));
}

/**
 * Formats epoch milliseconds for the model.
 *
 * @param value - A time value.
 * @returns An ISO 8601 string, or `undefined` for a missing value.
 */
function isoTime(value: unknown): string | undefined {
  return typeof value === 'number' ? new Date(value).toISOString() : undefined;
}

/** A number of a column, and its row. */
interface Point {
  /** The number. */
  readonly value: number;
  /** Its row. */
  readonly index: number;
}

/** A number with the time of its row. */
interface TimedPoint extends Point {
  /** The time of its row, epoch milliseconds. */
  readonly at: number;
}

/**
 * The points that have a time, in time order.
 *
 * @param points - The numbers of a column.
 * @param times - The frame's time column.
 * @returns The points with their times, earliest first.
 */
function timedPoints(points: readonly Point[], times: readonly unknown[]): TimedPoint[] {
  return points
    .flatMap((point) => {
      const at = times[point.index];
      return typeof at === 'number' ? [{ ...point, at }] : [];
    })
    .sort((left, right) => left.at - right.at);
}

/**
 * When a value was first reached.
 *
 * @param timed - The points, in time order.
 * @param value - The value.
 * @returns The time, ISO 8601, or `undefined` when no point with a time has it.
 */
function firstTimeOf(timed: readonly TimedPoint[], value: number): string | undefined {
  return isoTime(timed.find((point) => point.value === value)?.at);
}

/**
 * Merges consecutive points above a threshold into windows: a point at or below it closes the
 * window. The windows with the highest peaks are kept, in time order.
 *
 * @param timed - The points, in time order.
 * @param threshold - The spike threshold.
 * @returns At most {@link listLength} windows.
 */
function spikeWindowsOf(timed: readonly TimedPoint[], threshold: number): SpikeWindow[] {
  const windows: { from: number; to: number; peak: number }[] = [];
  let open: { from: number; to: number; peak: number } | undefined;
  for (const point of timed) {
    if (point.value <= threshold) {
      open = undefined;
    } else if (open) {
      open.to = point.at;
      open.peak = Math.max(open.peak, point.value);
    } else {
      open = { from: point.at, to: point.at, peak: point.value };
      windows.push(open);
    }
  }
  return windows
    .sort((left, right) => right.peak - left.peak)
    .slice(0, listLength)
    .sort((left, right) => left.from - right.from)
    .map((window) => ({
      from: new Date(window.from).toISOString(),
      to: new Date(window.to).toISOString(),
      peak: round(window.peak),
    }));
}

/**
 * When a number column was at its lowest and highest, and when it spiked.
 *
 * @param points - The numbers.
 * @param times - The frame's time column.
 * @param range - The minimum, the maximum and the spike threshold.
 * @returns The times; empty when no number has a time.
 */
function timesOf(
  points: readonly Point[],
  times: readonly unknown[],
  range: { readonly min: number; readonly max: number; readonly threshold: number },
) {
  const timed = timedPoints(points, times);
  if (timed.length === 0) return {};
  const minAt = firstTimeOf(timed, range.min);
  const maxAt = firstTimeOf(timed, range.max);
  return {
    ...(minAt === undefined ? {} : { minAt }),
    ...(maxAt === undefined ? {} : { maxAt }),
    spikeWindows: spikeWindowsOf(timed, range.threshold),
  };
}

/**
 * The values above the spike threshold, largest first, each with its time when it has one.
 *
 * @param points - The numbers.
 * @param threshold - The spike threshold.
 * @param times - The frame's time column, if it has one.
 * @returns At most {@link listLength} spikes.
 */
function spikesOf(points: readonly Point[], threshold: number, times: readonly unknown[] = []) {
  return points
    .filter((point) => point.value > threshold)
    .sort((left, right) => right.value - left.value)
    .slice(0, listLength)
    .map((point) => {
      const at = isoTime(times[point.index]);
      return at === undefined ? { value: round(point.value) } : { value: round(point.value), at };
    });
}

/**
 * Summarizes a number column.
 *
 * @param field - The field name.
 * @param values - The column.
 * @param times - The frame's time column, to date the extremes and spikes, if it has one.
 * @returns The summary.
 */
function summarizeNumbers(
  field: string,
  values: readonly unknown[],
  times: readonly unknown[] | undefined,
): FieldSummary {
  const present = values.flatMap((value, index) =>
    typeof value === 'number' ? [{ value, index }] : [],
  );
  const count = present.length;
  const base = { field, type: 'number' as const, count, nulls: values.length - count };
  if (count === 0) return { ...base, spikes: [] };
  const mean = present.reduce((sum, point) => sum + point.value, 0) / count;
  const deviation = Math.sqrt(
    present.reduce((sum, point) => sum + (point.value - mean) ** 2, 0) / count,
  );
  // With no spread, nothing stands out: the threshold sits above every value.
  const threshold = deviation > 0 ? mean + 3 * deviation : Number.POSITIVE_INFINITY;
  const numbers = present.map((point) => point.value);
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  return {
    ...base,
    min: round(min),
    max: round(max),
    mean: round(mean),
    spikes: spikesOf(present, threshold, times),
    ...(times ? timesOf(present, times, { min, max, threshold }) : {}),
  };
}

/**
 * Summarizes a string column.
 *
 * @param field - The field name.
 * @param values - The column.
 * @returns The summary.
 */
function summarizeStrings(field: string, values: readonly unknown[]): FieldSummary {
  const counts = new Map<string, number>();
  values.forEach((value) => {
    if (typeof value === 'string') counts.set(value, (counts.get(value) ?? 0) + 1);
  });
  const count = [...counts.values()].reduce((sum, value) => sum + value, 0);
  const top = [...counts]
    .sort((left, right) => right[1] - left[1])
    .slice(0, listLength)
    .map(([value, times]) => ({ value, count: times }));
  return { field, type: 'string', count, nulls: values.length - count, distinct: counts.size, top };
}

/**
 * Summarizes one field of a frame.
 *
 * @param field - The field.
 * @param values - Its column.
 * @param times - The frame's time column, if it has one.
 * @returns The summary.
 */
function summarizeField(
  field: Field,
  values: readonly unknown[],
  times: readonly unknown[] | undefined,
): FieldSummary {
  if (field.type === 'number') return summarizeNumbers(field.name, values, times);
  if (field.type === 'string') return summarizeStrings(field.name, values);
  const present = values.filter((value) => value !== null);
  const nulls = values.length - present.length;
  if (field.type === 'boolean') {
    return {
      field: field.name,
      type: 'boolean',
      count: present.length,
      nulls,
      true: present.filter(Boolean).length,
    };
  }
  const timestamps = present.filter((value): value is number => typeof value === 'number');
  const from = isoTime(timestamps.length > 0 ? Math.min(...timestamps) : undefined);
  const to = isoTime(timestamps.length > 0 ? Math.max(...timestamps) : undefined);
  return {
    field: field.name,
    type: 'time',
    count: present.length,
    nulls,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
}

/**
 * Summarizes every field of a frame.
 *
 * @param frame - The frame.
 * @returns One summary per field.
 */
export function summarizeFrame(frame: Frame): FieldSummary[] {
  const timeIndex = frame.fields.findIndex((field) => field.type === 'time');
  const times = timeIndex === -1 ? undefined : frame.values[timeIndex];
  return frame.fields.map((field, index) =>
    summarizeField(field, frame.values[index] ?? [], times),
  );
}
