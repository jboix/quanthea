/**
 * Reads what a condition needs of a result. Each test of the condition is a measure: the number
 * field it reads and how its points become a value. The series of the result carry one column of
 * points per measure, and an evaluation turns the points of its window into one reading per
 * measure. The evaluator, the check and the replay all read through here, so a new kind of
 * condition is a new measure and a new judgement, never a new path.
 */
import {
  type AlertReducer,
  type AlertSpec,
  type ConditionTest,
  conditionHolds,
  conditionTests,
  durationMs,
  type Frame,
  type Observation,
  type Reading,
  readingsBeside,
} from '@quanthea/shared';
import { reducePoints, type SeriesPoint, seriesOf } from './series.ts';

/** What one test reads of a series. */
export interface Measure {
  /** The number field; the first number field when left out. */
  readonly field: string | undefined;
  /** How the points of the window become its value. */
  readonly reduce: AlertReducer;
  /** How far back the earlier point of a change is, in milliseconds; `null` for other tests. */
  readonly withinMs: number | null;
}

/** A series of the result, with the points of each measure. */
export interface MeasuredSeries {
  /** The labels, written in order as `{name="value", …}`. */
  readonly key: string;
  /** The labels. */
  readonly labels: Readonly<Record<string, string>>;
  /** The points of each measure, in the order of the measures. */
  readonly columns: readonly (readonly SeriesPoint[])[];
}

/** The series of a result, as a condition reads them. */
export interface Measured {
  /** The measures of the condition. */
  readonly measures: readonly Measure[];
  /** The series kept, in order of their keys. */
  readonly series: readonly MeasuredSeries[];
  /** Whether series were dropped over the cap. */
  readonly truncated: boolean;
  /** What does not fit the spec, such as a column some frame does not have. */
  readonly problems: readonly string[];
  /** Why the result cannot be read at all: the problem of a measure that found no series. */
  readonly failure: string | undefined;
}

/**
 * The measure of one test: its own field and reducer, else the alert's. A change reads the latest
 * point, whatever the reducer.
 *
 * @param test - The test.
 * @param value - The alert's value.
 * @returns The measure.
 */
function measureOf(test: ConditionTest, value: AlertSpec['value']): Measure {
  const own = test as { readonly field?: string; readonly reduce?: AlertReducer };
  const field = own.field ?? value.field;
  if (test.kind === 'change') return { field, reduce: 'last', withinMs: durationMs(test.within) };
  return { field, reduce: own.reduce ?? value.reduce, withinMs: null };
}

/**
 * The measures of a spec: one per test of its condition, or the alert's value alone when the
 * condition has no test.
 *
 * @param spec - The spec.
 * @returns The measures, in the order of the tests. The first is the alert's value.
 */
export function measuresOf(spec: AlertSpec): Measure[] {
  const tests = conditionTests(spec.condition);
  if (tests.length === 0)
    return [{ field: spec.value.field, reduce: spec.value.reduce, withinMs: null }];
  return tests.map((test) => measureOf(test, spec.value));
}

/** The points of one field, by series key, with what did not fit. */
interface FieldColumn {
  /** The points of each series. */
  readonly points: ReadonlyMap<string, readonly SeriesPoint[]>;
  /** The labels of each series. */
  readonly labels: ReadonlyMap<string, Readonly<Record<string, string>>>;
  /** Whether series were dropped over the cap. */
  readonly truncated: boolean;
  /** What does not fit. */
  readonly problems: readonly string[];
  /** Whether the field gave no series. */
  readonly empty: boolean;
}

/**
 * Reads one field of a result as series.
 *
 * @param frames - The frames of the query.
 * @param value - How series are told apart, and the field.
 * @returns The points and labels by series key.
 */
function fieldColumn(frames: readonly Frame[], value: AlertSpec['value']): FieldColumn {
  const extraction = seriesOf(frames, value);
  return {
    points: new Map(extraction.series.map((each) => [each.key, each.points])),
    labels: new Map(extraction.series.map((each) => [each.key, each.labels])),
    truncated: extraction.truncated,
    problems: extraction.problems,
    empty: extraction.series.length === 0,
  };
}

/**
 * The series of a result, with the points of every measure of the spec's condition.
 *
 * @param frames - The frames of the query.
 * @param spec - The spec.
 * @returns The series that any measure found, at most `value.maxSeries`, and the problems.
 */
export function measure(frames: readonly Frame[], spec: AlertSpec): Measured {
  const measures = measuresOf(spec);
  const byField = new Map<string | undefined, FieldColumn>();
  for (const { field } of measures) {
    if (byField.has(field)) continue;
    const { field: _field, ...rest } = spec.value;
    byField.set(field, fieldColumn(frames, field === undefined ? rest : { ...rest, field }));
  }
  const columns = measures.map((each) => byField.get(each.field) as FieldColumn);
  const labels = new Map(columns.flatMap((column) => [...column.labels]));
  const keys = [...labels.keys()].sort();
  const series = keys.slice(0, spec.value.maxSeries).map((key) => ({
    key,
    labels: labels.get(key) ?? {},
    columns: columns.map((column) => column.points.get(key) ?? []),
  }));
  return {
    measures,
    series,
    truncated: keys.length > spec.value.maxSeries || columns.some((column) => column.truncated),
    problems: [...new Set(columns.flatMap((column) => column.problems))],
    failure: columns.find((column) => column.empty && column.problems.length > 0)?.problems[0],
  };
}

/**
 * The latest point with a time, and the latest one at least a span before it.
 *
 * @param points - The points of a window.
 * @param withinMs - The span.
 * @returns The value now and the earlier point; no earlier point without times or history.
 */
function changeReading(points: readonly SeriesPoint[], withinMs: number): Reading {
  const value = reducePoints(points, 'last');
  const latest = Math.max(...points.map((point) => point.at ?? Number.NEGATIVE_INFINITY));
  if (value === null || !Number.isFinite(latest)) return { value, reference: null };
  const earlier = points.filter((point) => point.at !== null && point.at <= latest - withinMs);
  return { value, reference: reducePoints(earlier, 'last') };
}

/**
 * What one measure reads of the points of a window.
 *
 * @param points - The points of the measure's field within the window.
 * @param measured - The measure.
 * @returns The reading.
 */
export function readingOf(points: readonly SeriesPoint[], measured: Measure): Reading {
  if (measured.withinMs !== null) return changeReading(points, measured.withinMs);
  return { value: reducePoints(points, measured.reduce) };
}

/** A series as one evaluation reads it. */
export interface SeriesReading {
  /** The value the series reports: the first measure's, the alert's value. */
  readonly value: number | null;
  /** Whether the condition holds for it. */
  readonly holds: boolean;
  /** One reading per measure. */
  readonly readings: readonly Reading[];
}

/**
 * Reads a series over one window, and judges the condition.
 *
 * @param spec - The spec.
 * @param measures - Its measures.
 * @param columns - The points of each measure within the window.
 * @returns The value, whether the condition holds, and the readings; `null` when no measure has a
 *   point, so the result left the series out.
 */
export function readSeries(
  spec: AlertSpec,
  measures: readonly Measure[],
  columns: readonly (readonly SeriesPoint[])[],
): SeriesReading | null {
  if (columns.every((points) => points.length === 0)) return null;
  const readings = measures.map((each, index) => readingOf(columns[index] ?? [], each));
  const value = readings[0]?.value ?? null;
  return { value, holds: conditionHolds(spec.condition, readings), readings };
}

/**
 * What an evaluation observes of a series over one window.
 *
 * @param spec - The spec.
 * @param measures - Its measures.
 * @param columns - The points of each measure within the window.
 * @returns The value with whether the condition holds, or `missing` without a point.
 */
export function observeSeries(
  spec: AlertSpec,
  measures: readonly Measure[],
  columns: readonly (readonly SeriesPoint[])[],
): Observation {
  const read = readSeries(spec, measures, columns);
  if (!read) return { kind: 'missing' };
  const readings = readingsBeside(read.readings);
  return { kind: 'value', value: read.value, holds: read.holds, ...(readings ? { readings } : {}) };
}
