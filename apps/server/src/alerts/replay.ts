/**
 * Replays an alert over a past window, such as the last 7 days of a draft: one query over the
 * whole window, at the evaluation step, then the state machine in time order. A condition that
 * compares with history reads the time before the window with one more query, once for the whole
 * replay and never once per step, and a ratio reads its second query over the window, once too.
 * A result without a time column cannot be replayed, and the replay says why.
 */
import { type AlertReplay, type AlertSpec, durationMs, type Frame } from '@quanthea/shared';
import { AppError } from '../lib/errors.ts';
import { historyBefore, rangedQuery } from './history.ts';
import { type Measured, measure } from './measure.ts';
import { type ReplayedSeries, replaySeries } from './replay-core.ts';
import { type AlertQueryDependencies, runAlertQuery, runDivisorQuery } from './run-query.ts';

/** The window of a replay, as asked. */
export interface ReplayRequest {
  /** The first evaluation, in epoch milliseconds. */
  readonly from: number;
  /** The last evaluation at most. */
  readonly to: number;
  /** The time between evaluations, such as `5m`; the spec's `every` when left out. */
  readonly step?: string | undefined;
}

/** The frames a replay reads of its query. */
interface ReplayFrames {
  /** Those of the span of its steps' windows. */
  readonly span: readonly Frame[];
  /** Those of the span before it, for a condition that reads history; none otherwise. */
  readonly before: readonly Frame[];
}

/** The longest window a replay covers: 31 days. */
const maxReplayMs = 31 * 86_400_000;

/** The most evaluations one replay runs. */
const maxEvaluations = 20_000;

/** The most points a replay returns across its series; series past it come without points. */
const maxReturnedPoints = 50_000;

/** Why a result without times cannot be replayed. */
const noTimeReason =
  'The query returns no time column, so its past values cannot be read one evaluation at a ' +
  'time. A replay needs a time series, such as a query grouped by time.';

/** Why a ratio whose second query has no times cannot be replayed. */
const noDivisorTimeReason =
  'The second query returns no time column, so the ratio cannot be read one evaluation at a ' +
  'time. A replay needs a time series from both queries, such as queries grouped by time.';

/**
 * Checks the window and works out the step.
 *
 * @param spec - The spec.
 * @param request - The window, as asked.
 * @returns The step, in milliseconds.
 * @throws {AppError} `bad_request` for a window that does not run forwards, is too long, or has
 *   too many evaluations for its step.
 */
function stepOf(spec: AlertSpec, request: ReplayRequest): number {
  const stepMs = durationMs(request.step ?? spec.every);
  const length = request.to - request.from;
  if (!(length > 0)) throw new AppError('bad_request', 'The window ends before it starts.');
  if (length > maxReplayMs) throw new AppError('bad_request', 'Replay at most 31 days.');
  if (!(stepMs >= 60_000)) throw new AppError('bad_request', 'Use a step of 1m or more.');
  if (length / stepMs > maxEvaluations)
    throw new AppError('bad_request', 'The window has too many steps; use a longer step.');
  return stepMs;
}

/**
 * Reads the points a replay feeds its steps: the query over the span of their windows, as a range
 * query at the step for PromQL and LogQL, and, for a condition that reads history, the same query
 * over the span before it. The two results are read as one stretch of time.
 *
 * @param dependencies - The connectors and the executor.
 * @param spec - The spec.
 * @param span - The span of the steps' windows.
 * @param step - The step, as a duration.
 * @returns The frames of the span, and those of the span before it, read first.
 * @throws {AppError} `source_failed` when a query fails.
 */
async function readFrames(
  dependencies: AlertQueryDependencies,
  spec: AlertSpec,
  span: { readonly from: number; readonly to: number },
  step: string,
): Promise<ReplayFrames> {
  const query = rangedQuery(spec.query, step);
  const before = historyBefore(spec, span);
  const read: Frame[][] = [];
  for (const range of before ? [before, span] : [span]) {
    const outcome = await runAlertQuery(dependencies, spec, range, query);
    if ('error' in outcome) throw new AppError('source_failed', outcome.error);
    read.push([...outcome.frames]);
  }
  return { span: read.at(-1) ?? [], before: before ? (read[0] ?? []) : [] };
}

/**
 * Reads the series of a replay. They are the series of its own span, at most `value.maxSeries`;
 * the span before it only adds the history of those. A series that only the time before has
 * takes no place under the cap, as it takes none in an evaluation.
 *
 * @param spec - The spec.
 * @param frames - The frames of the span and of the span before it.
 * @param divisor - The frames of the second query, for a ratio.
 * @returns The series of the span, with their points over both spans.
 */
function measureReplay(
  spec: AlertSpec,
  frames: ReplayFrames,
  divisor: readonly Frame[] | undefined,
): Measured {
  const own = measure(frames.span, spec, undefined, divisor);
  if (frames.before.length === 0) return own;
  const uncapped = { ...spec, value: { ...spec.value, maxSeries: Number.MAX_SAFE_INTEGER } };
  const whole = measure([...frames.before, ...frames.span], uncapped, undefined, divisor);
  const kept = new Set(own.series.map((each) => each.key));
  return { ...own, series: whole.series.filter((each) => kept.has(each.key)) };
}

/**
 * Reads the second query of a ratio over the span of a replay, as a range query at the step.
 *
 * @param dependencies - The connectors and the executor.
 * @param spec - The spec.
 * @param span - The span of the steps' windows.
 * @param step - The step, as a duration.
 * @returns Its frames, or nothing for a spec without a second query.
 * @throws {AppError} `source_failed` when the query fails.
 */
async function readDivisor(
  dependencies: AlertQueryDependencies,
  spec: AlertSpec,
  span: { readonly from: number; readonly to: number },
  step: string,
): Promise<readonly Frame[] | undefined> {
  const query = spec.dividedBy && rangedQuery(spec.dividedBy.query, step);
  const outcome = await runDivisorQuery(dependencies, spec, span, query);
  if (outcome && 'error' in outcome) throw new AppError('source_failed', outcome.error);
  return outcome;
}

/**
 * Whether every frame with rows has a time column.
 *
 * @param frames - The frames.
 * @returns `true` when each can be read at points in time.
 */
function timed(frames: readonly Frame[]): boolean {
  return frames.every(
    (frame) => frame.meta.rowCount === 0 || frame.fields.some((field) => field.type === 'time'),
  );
}

/**
 * Keeps the points of the series that fired most, within the budget; the rest come without.
 *
 * @param series - The replayed series.
 * @returns The series, in their order, some without points.
 */
function withinBudget(series: readonly ReplayedSeries[]): ReplayedSeries[] {
  const order = [...series].sort((first, second) => second.firingMs - first.firingMs);
  let budget = maxReturnedPoints;
  const kept = new Set<string>();
  for (const each of order) {
    if (each.points.length > budget) break;
    budget -= each.points.length;
    kept.add(each.key);
  }
  return series.map((each) => (kept.has(each.key) ? each : { ...each, points: [] }));
}

/**
 * Replays a spec over a past window.
 *
 * @param dependencies - The connectors and the executor.
 * @param spec - A valid spec.
 * @param request - The window and the step.
 * @returns How each series would have behaved, or why the spec cannot be replayed.
 * @throws {AppError} `bad_request` for a bad window, `source_failed` when the query fails.
 */
export async function replayAlert(
  dependencies: AlertQueryDependencies,
  spec: AlertSpec,
  request: ReplayRequest,
): Promise<AlertReplay> {
  const stepMs = stepOf(spec, request);
  const reach = Math.max(durationMs(spec.lookback), stepMs);
  const span = { from: request.from - reach, to: request.to };
  const step = request.step ?? spec.every;
  const frames = await readFrames(dependencies, spec, span, step);
  if (!timed([...frames.before, ...frames.span]))
    return { replayable: false, reason: noTimeReason };
  const divisor = await readDivisor(dependencies, spec, span, step);
  if (!timed(divisor ?? [])) return { replayable: false, reason: noDivisorTimeReason };
  const measured = measureReplay(spec, frames, divisor);
  if (measured.failure !== undefined) return { replayable: false, reason: measured.failure };
  const window = { from: request.from, to: request.to, stepMs };
  const series = withinBudget(replaySeries(spec, measured, window));
  return { replayable: true, ...window, series, truncated: measured.truncated };
}
