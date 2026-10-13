/**
 * Replays an alert over past points: at each step it reads the window that evaluation would have
 * queried, for a ratio the same window of the second query, and for a condition that reads
 * history the window a period back or the baseline before it, feeds the state machine in time order, and reports when each series would have fired, and
 * when the condition held but not long enough to fire. Pure.
 */
import {
  type AlertSpec,
  conditionDirection,
  durationMs,
  type Observation,
  type ReplayTrack,
  replayRule,
  type StateRule,
  trackSeries,
} from '@quanthea/shared';
import { baselineReader } from './baseline.ts';
import { type Measure, type MeasuredSeries, observeSeries, type Past } from './measure.ts';
import { wholeAlertKey } from './observe.ts';
import { reducePoints, type SeriesPoint } from './series.ts';

/** How one series would have behaved, with its key and labels. */
export interface ReplayedSeries extends ReplayTrack {
  /** The series key. */
  readonly key: string;
  /** The labels. */
  readonly labels: Readonly<Record<string, string>>;
}

/**
 * The series a replay reads: their points over the whole replay, and over the time before it for
 * a condition that reads history, in one column per measure.
 */
export interface ReplayInput {
  /** The measures of the condition. */
  readonly measures: readonly Measure[];
  /** The series, with the points of each measure, and of the second query of a ratio. */
  readonly series: readonly (Omit<MeasuredSeries, 'history' | 'divisor'> &
    Partial<Pick<MeasuredSeries, 'divisor'>>)[];
}

/** The evaluations of a replay. */
export interface ReplayWindow {
  /** The first evaluation, in epoch milliseconds. */
  readonly from: number;
  /** The last one at most. */
  readonly to: number;
  /** The time between evaluations. */
  readonly stepMs: number;
}

/**
 * The timing rule of a spec, for the state machine.
 *
 * @param spec - The spec.
 * @returns How long the condition holds before firing, and the grace of a missing series.
 */
export function ruleOf(spec: AlertSpec): StateRule {
  return replayRule(spec.condition.for, spec.every);
}

/**
 * The instants of the evaluations.
 *
 * @param window - The window.
 * @returns The instants, from the start, a step apart.
 */
function evaluationTimes(window: ReplayWindow): number[] {
  const times: number[] = [];
  for (let at = window.from; at <= window.to; at += window.stepMs) times.push(at);
  return times;
}

/**
 * A reader of the points within the window of each evaluation, as the times move forwards.
 *
 * @param points - The points of a series.
 * @param windowMs - The length of each evaluation's window.
 * @returns A function from an evaluation time to the points in `(at - windowMs, at]`.
 */
function slidingWindow(points: readonly SeriesPoint[], windowMs: number) {
  const sorted = [...points].sort((first, second) => (first.at ?? 0) - (second.at ?? 0));
  let start = 0;
  let end = 0;
  return (at: number): readonly SeriesPoint[] => {
    while (end < sorted.length && (sorted[end]?.at ?? 0) <= at) end += 1;
    while (start < end && (sorted[start]?.at ?? 0) <= at - windowMs) start += 1;
    return sorted.slice(start, end);
  };
}

/**
 * A reader of what a measure with history knows of the past at each evaluation, from the points of
 * the whole replay: the window a period back reduced as the window is, or the baseline before the
 * window. The times need not move forwards for a baseline.
 *
 * @param points - The points of the measure's field, the time before the replay included.
 * @param measured - The measure.
 * @param windowMs - The length of each evaluation's window.
 * @returns A function from an evaluation time to the past, or `undefined` without history.
 */
function pastReader(
  points: readonly SeriesPoint[],
  measured: Measure,
  windowMs: number,
): ((at: number) => Past) | undefined {
  const { history, reduce } = measured;
  if (!history) return undefined;
  if (history.kind === 'shifted') {
    const read = slidingWindow(points, windowMs);
    return (at) => ({ reference: reducePoints(read(at - history.ms), reduce) });
  }
  const between = baselineReader(points);
  return (at) => {
    const baseline = between(at - windowMs - history.ms, at - windowMs, history.ms);
    return { reference: baseline?.mean ?? null, spread: baseline?.deviation ?? null };
  };
}

/**
 * A reader of what one series gives each evaluation: the points of its window, per measure, what
 * each measure with history knows of the past, and the points of the second query of a ratio.
 *
 * @param measures - The measures.
 * @param series - The points of each measure, and of the matching series of the second query.
 * @param windowMs - The length of each evaluation's window.
 * @returns A function from an evaluation time to the points, the pasts and the divisor's points.
 */
function seriesReader(
  measures: readonly Measure[],
  series: ReplayInput['series'][number],
  windowMs: number,
) {
  const windows = series.columns.map((points) => slidingWindow(points, windowMs));
  const pasts = series.columns.map((points, index) => {
    const measured = measures[index];
    return measured && pastReader(points, measured, windowMs);
  });
  const divisor = slidingWindow(series.divisor ?? [], windowMs);
  return (at: number) => ({
    columns: windows.map((read) => read(at)),
    pasts: pasts.map((read) => read?.(at)),
    divisor: divisor(at),
  });
}

/**
 * Whether a series has a point an evaluation of the replay reads in its window. A series that
 * only has points in the history read before the replay is not one of its series.
 *
 * @param columns - The points of each measure.
 * @param since - The start of the first evaluation's window.
 * @returns `true` when a point is later.
 */
function seenSince(columns: readonly (readonly SeriesPoint[])[], since: number): boolean {
  return columns.some((points) => points.some((point) => (point.at ?? 0) > since));
}

/**
 * Runs the state machine over the evaluations of one series of a spec.
 *
 * @param spec - The spec.
 * @param window - The evaluations.
 * @param observeAt - What each evaluation observes.
 * @returns How the series would have behaved.
 */
function track(spec: AlertSpec, window: ReplayWindow, observeAt: (at: number) => Observation) {
  return trackSeries({
    rule: ruleOf(spec),
    direction: conditionDirection(spec.condition),
    times: evaluationTimes(window),
    observeAt,
    end: window.to,
  });
}

/**
 * Replays the `no_data` condition: it holds at an evaluation whose window has no point at all.
 *
 * @param spec - The spec.
 * @param measured - The series of the query over the whole window.
 * @param window - The evaluations.
 * @returns One series, for the alert as a whole.
 */
function replayNoData(
  spec: AlertSpec,
  measured: ReplayInput,
  window: ReplayWindow,
): ReplayedSeries[] {
  const windowMs = Math.max(durationMs(spec.lookback), window.stepMs);
  const readers = measured.series.map((each) =>
    each.columns.map((points) => slidingWindow(points, windowMs)),
  );
  const observeAt = (at: number): Observation => {
    const holds = readers.every((columns) => columns.every((read) => read(at).length === 0));
    return { kind: 'value', value: null, holds };
  };
  return [{ key: wholeAlertKey, labels: {}, ...track(spec, window, observeAt) }];
}

/**
 * Replays a spec over the series of a past result. Each evaluation reads the points of its window
 * and judges them as the evaluator does.
 *
 * @param spec - The spec.
 * @param measured - The series of the query over the whole window, with times, and over the time
 *   before it for a condition that reads history.
 * @param window - The evaluations.
 * @returns How each series would have behaved; one series for the alert as a whole under a
 *   `no_data` condition.
 */
export function replaySeries(
  spec: AlertSpec,
  measured: ReplayInput,
  window: ReplayWindow,
): ReplayedSeries[] {
  if (spec.condition.kind === 'no_data') return replayNoData(spec, measured, window);
  const windowMs = Math.max(durationMs(spec.lookback), window.stepMs);
  const { measures } = measured;
  const reads = measures.some((each) => each.history);
  const series = measured.series.filter(
    (each) => !reads || seenSince(each.columns, window.from - windowMs),
  );
  return series.map((each) => {
    const read = seriesReader(measures, each, windowMs);
    const observeAt = (at: number): Observation => {
      const { columns, pasts, divisor } = read(at);
      return observeSeries(spec, measures, columns, pasts, divisor);
    };
    return { key: each.key, labels: each.labels, ...track(spec, window, observeAt) };
  });
}
