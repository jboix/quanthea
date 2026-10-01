/** Level 3 summaries of a result: per field counts, ranges, means, spikes and top values. */
import type { Field, Frame } from '@quanthea/shared';

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

/**
 * Summarizes a number column.
 *
 * @param field - The field name.
 * @param values - The column.
 * @param times - The frame's time column, to date the spikes, if it has one.
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
  const spikes = present
    .filter((point) => deviation > 0 && point.value > mean + 3 * deviation)
    .sort((left, right) => right.value - left.value)
    .slice(0, listLength)
    .map((point) => {
      const at = isoTime(times?.[point.index]);
      return at === undefined ? { value: round(point.value) } : { value: round(point.value), at };
    });
  const numbers = present.map((point) => point.value);
  return {
    ...base,
    min: round(Math.min(...numbers)),
    max: round(Math.max(...numbers)),
    mean: round(mean),
    spikes,
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
