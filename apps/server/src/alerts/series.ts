/**
 * Turns the frames of an alert's query into series: one per set of labels, each with its points.
 * A series is a field's labels plus the text columns of its row, or the columns the spec names.
 */
import type { AlertSpec, Field, Frame } from '@quanthea/shared';

/** One point of a series. */
export interface SeriesPoint {
  /** When, in epoch milliseconds; `null` when the result has no time column. */
  readonly at: number | null;
  /** The value. */
  readonly value: number;
}

/** A series of the result. */
export interface ObservedSeries {
  /** The labels, written in order as `{name="value", …}`. */
  readonly key: string;
  /** The labels. */
  readonly labels: Readonly<Record<string, string>>;
  /** The points, in the order of the result. */
  readonly points: readonly SeriesPoint[];
}

/** The series of a result. */
export interface SeriesExtraction {
  /** The series kept, in order of their keys. */
  readonly series: readonly ObservedSeries[];
  /** Whether series were dropped over the cap. */
  readonly truncated: boolean;
  /** What does not fit the spec, such as a missing column. */
  readonly problems: readonly string[];
}

/** A series while its points are collected. */
interface GrowingSeries extends ObservedSeries {
  /** The points so far. */
  readonly points: SeriesPoint[];
}

/** How the value is read: the spec's `value`. */
type ValueSpec = AlertSpec['value'];

/** The columns of one frame that make series. */
interface FrameColumns {
  /** The index of the number field. */
  readonly value: number;
  /** The index of the time field, or -1. */
  readonly time: number;
  /** The indexes of the label columns. */
  readonly labels: readonly number[];
}

/**
 * The key of a set of labels.
 *
 * @param labels - The labels.
 * @returns Such as `{code="500", service="checkout"}`; `{}` for none.
 */
export function seriesKeyOf(labels: Readonly<Record<string, string>>): string {
  const pairs = Object.keys(labels)
    .sort()
    .map((name) => `${name}=${JSON.stringify(labels[name])}`);
  return `{${pairs.join(', ')}}`;
}

/**
 * Finds the columns of a frame, or says what is missing.
 *
 * @param fields - The frame's fields.
 * @param value - How the value is read.
 * @returns The columns, or the problem.
 */
function columnsOf(fields: readonly Field[], value: ValueSpec): FrameColumns | string {
  const index = fields.findIndex((field) =>
    value.field === undefined ? field.type === 'number' : field.name === value.field,
  );
  if (index < 0) return value.field ? `No column "${value.field}".` : 'No number column.';
  if (fields[index]?.type !== 'number') return `"${value.field}" is not a number column.`;
  const named = (name: string) => fields.findIndex((field) => field.name === name);
  const labels = value.by
    ? value.by.map(named)
    : fields.flatMap((field, position) => (field.type === 'string' ? [position] : []));
  const missing = value.by?.find((_name, position) => (labels[position] ?? -1) < 0);
  if (missing !== undefined) return `No column "${missing}".`;
  return { value: index, time: fields.findIndex((field) => field.type === 'time'), labels };
}

/**
 * The labels of one row.
 *
 * @param frame - The frame.
 * @param columns - Its columns.
 * @param row - The row.
 * @returns The value field's labels and the row's label columns.
 */
function rowLabels(frame: Frame, columns: FrameColumns, row: number): Record<string, string> {
  const labels: Record<string, string> = { ...frame.fields[columns.value]?.labels };
  for (const index of columns.labels) {
    const name = frame.fields[index]?.name ?? '';
    labels[name] = String(frame.values[index]?.[row] ?? '');
  }
  return labels;
}

/**
 * Adds the points of one frame to the series.
 *
 * @param frame - The frame.
 * @param columns - Its columns.
 * @param series - The series so far, by key.
 */
function addFrame(frame: Frame, columns: FrameColumns, series: Map<string, GrowingSeries>): void {
  const values = frame.values[columns.value] ?? [];
  const times = columns.time < 0 ? [] : (frame.values[columns.time] ?? []);
  values.forEach((value, row) => {
    if (typeof value !== 'number') return;
    const labels = rowLabels(frame, columns, row);
    const key = seriesKeyOf(labels);
    const at = typeof times[row] === 'number' ? (times[row] as number) : null;
    const known = series.get(key) ?? { key, labels, points: [] };
    known.points.push({ at, value });
    series.set(key, known);
  });
}

/**
 * The series of a result.
 *
 * @param frames - The frames of the query.
 * @param value - How the value is read and series are told apart.
 * @returns The series, at most `value.maxSeries`, and the problems.
 */
export function seriesOf(frames: readonly Frame[], value: ValueSpec): SeriesExtraction {
  const series = new Map<string, GrowingSeries>();
  const problems = new Set<string>();
  for (const frame of frames) {
    if (frame.meta.rowCount === 0) continue;
    const columns = columnsOf(frame.fields, value);
    if (typeof columns === 'string') problems.add(columns);
    else addFrame(frame, columns, series);
  }
  const sorted = [...series.values()].sort((first, second) => (first.key < second.key ? -1 : 1));
  return {
    series: sorted.slice(0, value.maxSeries),
    truncated: sorted.length > value.maxSeries,
    problems: [...problems],
  };
}

/**
 * Reduces points to one value.
 *
 * @param points - The points, in the order of the result.
 * @param reduce - How: the latest, the extreme, the mean or the sum.
 * @returns The value, or `null` without points.
 */
export function reducePoints(
  points: readonly SeriesPoint[],
  reduce: ValueSpec['reduce'],
): number | null {
  if (points.length === 0) return null;
  const values = points.map((point) => point.value);
  if (reduce === 'max') return Math.max(...values);
  if (reduce === 'min') return Math.min(...values);
  const sum = values.reduce((total, each) => total + each, 0);
  if (reduce === 'sum') return sum;
  if (reduce === 'mean') return sum / values.length;
  return latestOf(points);
}

/**
 * The value of the latest point: the one with the greatest time, else the last.
 *
 * @param points - At least one point.
 * @returns Its value.
 */
function latestOf(points: readonly SeriesPoint[]): number {
  let latest = points.at(-1) as SeriesPoint;
  for (const point of points)
    if (point.at !== null && (latest.at === null || point.at >= latest.at)) latest = point;
  return latest.value;
}
