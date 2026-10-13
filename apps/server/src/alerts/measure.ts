/**
 * Reads what a condition needs of a result. Each test of the condition is a measure: the number
 * field it reads, how its points become a value, and what it needs of the time before the window.
 * The series of the result carry one column of points per measure, and an evaluation turns the
 * points of its window into one reading per measure. A measure of a ratio also reads the matching
 * series of the second query. The evaluator, the check and the replay all read through here, so a
 * new kind of condition is a new measure and a new judgement, never a new path.
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
  type RatioZeroRule,
  type Reading,
  readingsBeside,
  readsRatio,
} from '@quanthea/shared';
import { baselineReader } from './baseline.ts';
import { divisorFor, divisorSeries, ratioReading } from './ratio.ts';
import { reducePoints, type SeriesPoint, seriesOf } from './series.ts';

/**
 * What a measure reads of the time before the window, through a query of its own: the same window
 * a period back (`shifted`), or the baseline before the window that a band is learned from.
 */
export interface History {
  /** Which of the two. */
  readonly kind: 'shifted' | 'baseline';
  /** How far back the window is shifted, or how long the baseline is, in milliseconds. */
  readonly ms: number;
}

/** What one test reads of a series. */
export interface Measure {
  /** The number field; the first number field when left out. */
  readonly field: string | undefined;
  /** How the points of the window become its value. */
  readonly reduce: AlertReducer;
  /** How far back the earlier point of a change is, in milliseconds; `null` for other tests. */
  readonly withinMs: number | null;
  /** What it reads of the time before the window; nothing for most tests. */
  readonly history?: History | undefined;
  /**
   * For a measure that reads a ratio, what a division by 0 reads. Its value is then its reading of
   * the first query divided by the same reading of the second.
   */
  readonly ratio?: RatioZeroRule | undefined;
}

/** What a measure knows of the time before the window, at one evaluation. */
export interface Past {
  /** The value a period before, or the mean of the baseline; `null` when there is none. */
  readonly reference: number | null;
  /** The deviation of the baseline; `null` with too little history. */
  readonly spread?: number | null;
}

/** A series of the result, with the points of each measure. */
export interface MeasuredSeries {
  /** The labels, written in order as `{name="value", …}`. */
  readonly key: string;
  /** The labels. */
  readonly labels: Readonly<Record<string, string>>;
  /** The points of each measure, in the order of the measures. */
  readonly columns: readonly (readonly SeriesPoint[])[];
  /**
   * The points each measure read of the time before the window, from the history query; none for
   * a measure without history, and when no history was read.
   */
  readonly history: readonly (readonly SeriesPoint[])[];
  /**
   * The points of the series of the second query this one is divided by; none without a ratio,
   * and when no one series of the second query matches its labels.
   */
  readonly divisor: readonly SeriesPoint[];
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
  /** What does not fit the spec in the result of a ratio's second query. */
  readonly divisorProblems: readonly string[];
  /** Why the result cannot be read at all: the problem of a measure that found no series. */
  readonly failure: string | undefined;
}

/**
 * The measure of one test: its own field and reducer, else the alert's. A change reads the latest
 * point, whatever the reducer. A test that names no field reads the alert's value, which is the
 * ratio when the alert has a second query.
 *
 * @param test - The test.
 * @param spec - The spec.
 * @returns The measure.
 */
function measureOf(test: ConditionTest, spec: AlertSpec): Measure {
  const { value } = spec;
  const own = test as { readonly field?: string; readonly reduce?: AlertReducer };
  const field = own.field ?? value.field;
  const ratio = readsRatio(test) ? spec.dividedBy?.whenZero : undefined;
  if (test.kind === 'change')
    return { field, reduce: 'last', withinMs: durationMs(test.within), ratio };
  const reduced = { field, reduce: own.reduce ?? value.reduce, withinMs: null, ratio };
  if (test.kind === 'past')
    return { ...reduced, history: { kind: 'shifted', ms: durationMs(test.ago) } };
  if (test.kind === 'band')
    return { ...reduced, history: { kind: 'baseline', ms: durationMs(test.baseline) } };
  return reduced;
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
  return tests.map((test) => measureOf(test, spec));
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
 * Reads the field of each measure of a spec from a result.
 *
 * @param frames - The frames of a query.
 * @param spec - The spec.
 * @param measures - Its measures.
 * @returns One column per measure, in their order; measures on one field share it.
 */
function fieldColumns(
  frames: readonly Frame[],
  spec: AlertSpec,
  measures: readonly Measure[],
): FieldColumn[] {
  const byField = new Map<string | undefined, FieldColumn>();
  for (const { field } of measures) {
    if (byField.has(field)) continue;
    const { field: _field, ...rest } = spec.value;
    byField.set(field, fieldColumn(frames, field === undefined ? rest : { ...rest, field }));
  }
  return measures.map((each) => byField.get(each.field) as FieldColumn);
}

/**
 * The points the measures read of the time before the window, by measure and series key. Every
 * series of the history result is read, under no cap: the window's series take theirs by key, and
 * a cap by key order would leave the later ones without history, and so without a verdict.
 *
 * @param frames - The frames of the history query, if one ran.
 * @param spec - The spec.
 * @param measures - Its measures.
 * @returns For each measure, the points of each series; nothing for a measure without history.
 */
function historyColumns(
  frames: readonly Frame[] | undefined,
  spec: AlertSpec,
  measures: readonly Measure[],
): (ReadonlyMap<string, readonly SeriesPoint[]> | undefined)[] {
  if (!frames) return measures.map(() => undefined);
  const columns = fieldColumns(
    frames,
    { ...spec, value: { ...spec.value, maxSeries: Number.MAX_SAFE_INTEGER } },
    measures,
  );
  return measures.map((each, index) => (each.history ? columns[index]?.points : undefined));
}

/**
 * The series of a result, with the points of every measure of the spec's condition.
 *
 * @param frames - The frames of the query.
 * @param spec - The spec.
 * @param history - The frames of the history query, when the condition reads history and the
 *   caller ran it apart: the evaluator and the check do, the replay reads one span of time.
 * @param divisor - The frames of the second query, for a ratio.
 * @returns The series that any measure found, at most `value.maxSeries`, and the problems.
 */
export function measure(
  frames: readonly Frame[],
  spec: AlertSpec,
  history?: readonly Frame[],
  divisor?: readonly Frame[],
): Measured {
  const measures = measuresOf(spec);
  const columns = fieldColumns(frames, spec, measures);
  const before = historyColumns(history, spec, measures);
  const second = divisorSeries(divisor ?? [], spec);
  const labels = new Map(columns.flatMap((column) => [...column.labels]));
  const keys = [...labels.keys()].sort();
  const series = keys.slice(0, spec.value.maxSeries).map((key) => ({
    key,
    labels: labels.get(key) ?? {},
    columns: columns.map((column) => column.points.get(key) ?? []),
    history: before.map((column) => column?.get(key) ?? []),
    divisor: divisorFor(labels.get(key) ?? {}, second.series)?.points ?? [],
  }));
  return {
    measures,
    series,
    truncated: keys.length > spec.value.maxSeries || columns.some((column) => column.truncated),
    problems: [...new Set(columns.flatMap((column) => column.problems))],
    divisorProblems: second.problems,
    failure: failureOf(columns, second, spec.dividedBy !== undefined && keys.length > 0),
  };
}

/** Why a ratio whose second query returned nothing cannot be read. */
const noDivisorReason =
  'The second query returned no series while the first returned some, so the ratio has no value.';

/**
 * Why a result cannot be read at all: a field that gave no series and says why, in the first
 * query or in the second, or a second query that gave no series for the first's to be divided by.
 *
 * @param columns - The fields of the first query.
 * @param second - The series of the second query.
 * @param divided - Whether the first query returned series that a second query divides.
 * @returns The reason, or `undefined` when every field could be read.
 */
function failureOf(
  columns: readonly FieldColumn[],
  second: ReturnType<typeof divisorSeries>,
  divided: boolean,
): string | undefined {
  const first = columns.find((column) => column.empty && column.problems.length > 0)?.problems[0];
  if (first !== undefined || second.series.length > 0) return first;
  const [problem] = second.problems;
  if (problem !== undefined) return `The second query: ${problem}`;
  return divided ? noDivisorReason : undefined;
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

/** What a measure with history reads when the past says nothing. */
const noPast: Readonly<Record<History['kind'], Past>> = {
  shifted: { reference: null },
  baseline: { reference: null, spread: null },
};

/**
 * What a measure knows of the past from the points its history query returned: the points of the
 * shifted window reduced as the window's are, or the mean and deviation of the baseline.
 *
 * @param measured - The measure.
 * @param points - The points of the series in the history result.
 * @returns What it knows, or `undefined` for a measure without history.
 */
export function pastOf(measured: Measure, points: readonly SeriesPoint[]): Past | undefined {
  const { history } = measured;
  if (!history) return undefined;
  if (history.kind === 'shifted') return { reference: reducePoints(points, measured.reduce) };
  const baseline = baselineReader(points)(
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    history.ms,
  );
  return baseline ? { reference: baseline.mean, spread: baseline.deviation } : noPast.baseline;
}

/**
 * What one measure reads of the points of one query within a window.
 *
 * @param points - The points of the measure's field within the window.
 * @param measured - The measure.
 * @param past - What it knows of the time before the window, for a measure with history.
 * @returns The reading.
 */
function plainReading(
  points: readonly SeriesPoint[],
  measured: Measure,
  past?: Past | undefined,
): Reading {
  if (measured.withinMs !== null) return changeReading(points, measured.withinMs);
  const value = reducePoints(points, measured.reduce);
  if (!measured.history) return { value };
  return { value, ...(past ?? noPast[measured.history.kind]) };
}

/**
 * What one measure reads of the points of a window. A measure of a ratio reads the second query's
 * points the same way, and divides.
 *
 * @param points - The points of the measure's field within the window.
 * @param measured - The measure.
 * @param past - What it knows of the time before the window, for a measure with history.
 * @param divisor - The points of the matching series of the second query within the window.
 * @returns The reading.
 */
export function readingOf(
  points: readonly SeriesPoint[],
  measured: Measure,
  past?: Past | undefined,
  divisor: readonly SeriesPoint[] = [],
): Reading {
  const reading = plainReading(points, measured, past);
  if (measured.ratio === undefined) return reading;
  return ratioReading(reading, plainReading(divisor, measured), measured.ratio);
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
 * @param pasts - What each measure with history knows of the time before the window.
 * @param divisor - The points of the matching series of a ratio's second query within the window.
 * @returns The value, whether the condition holds, and the readings; `null` when no measure has a
 *   point, so the result left the series out, and when a ratio has no point of the second query
 *   to be divided by: the series then has no value to judge, and is missing as one left out.
 */
export function readSeries(
  spec: AlertSpec,
  measures: readonly Measure[],
  columns: readonly (readonly SeriesPoint[])[],
  pasts: readonly (Past | undefined)[] = [],
  divisor: readonly SeriesPoint[] = [],
): SeriesReading | null {
  if (columns.every((points) => points.length === 0)) return null;
  if (divisor.length === 0 && measures.some((each) => each.ratio !== undefined)) return null;
  const readings = measures.map((each, index) =>
    readingOf(columns[index] ?? [], each, pasts[index], divisor),
  );
  const value = readings[0]?.value ?? null;
  return { value, holds: conditionHolds(spec.condition, readings), readings };
}

/**
 * What an evaluation observes of a series over one window.
 *
 * @param spec - The spec.
 * @param measures - Its measures.
 * @param columns - The points of each measure within the window.
 * @param pasts - What each measure with history knows of the time before the window.
 * @param divisor - The points of the matching series of a ratio's second query within the window.
 * @returns The value with whether the condition holds, or `missing` without a point, and for a
 *   ratio without a point of the second query.
 */
export function observeSeries(
  spec: AlertSpec,
  measures: readonly Measure[],
  columns: readonly (readonly SeriesPoint[])[],
  pasts: readonly (Past | undefined)[] = [],
  divisor: readonly SeriesPoint[] = [],
): Observation {
  const read = readSeries(spec, measures, columns, pasts, divisor);
  if (!read) return { kind: 'missing' };
  const readings = readingsBeside(read.readings);
  return { kind: 'value', value: read.value, holds: read.holds, ...(readings ? { readings } : {}) };
}

/**
 * What each measure knows of the past for one series of a result read with its history.
 *
 * @param measured - The series of the result.
 * @param series - One of them.
 * @returns One past per measure; `undefined` for a measure without history.
 */
export function pastsOf(
  measured: Pick<Measured, 'measures'>,
  series: Pick<MeasuredSeries, 'history'>,
): (Past | undefined)[] {
  return measured.measures.map((each, index) => pastOf(each, series.history[index] ?? []));
}
