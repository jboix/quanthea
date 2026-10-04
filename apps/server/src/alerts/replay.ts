/**
 * Replays an alert over a past window, such as the last 7 days of a draft: one query over the
 * whole window, at the evaluation step, then the state machine in time order. A result without a
 * time column cannot be replayed, and the replay says why.
 */
import {
  type AlertReplay,
  type AlertSpec,
  durationMs,
  type Frame,
  type PanelQuery,
} from '@quanthea/shared';
import { AppError } from '../lib/errors.ts';
import { type ReplayedSeries, replaySeries } from './replay-core.ts';
import { type AlertQueryDependencies, runAlertQuery } from './run-query.ts';
import { seriesOf } from './series.ts';

/** The window of a replay, as asked. */
export interface ReplayRequest {
  /** The first evaluation, in epoch milliseconds. */
  readonly from: number;
  /** The last evaluation at most. */
  readonly to: number;
  /** The time between evaluations, such as `5m`; the spec's `every` when left out. */
  readonly step?: string | undefined;
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
 * The query a replay runs: a PromQL or LogQL query over the range at the step, never instant.
 *
 * @param spec - The spec.
 * @param step - The step, as a duration.
 * @returns The query.
 */
function replayQuery(spec: AlertSpec, step: string): PanelQuery {
  const { query } = spec;
  if (query.language !== 'promql' && query.language !== 'logql') return query;
  const { instant: _instant, ...ranged } = query;
  return { ...ranged, step };
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
  const range = { from: request.from - reach, to: request.to };
  const query = replayQuery(spec, request.step ?? spec.every);
  const outcome = await runAlertQuery(dependencies, spec, range, query);
  if ('error' in outcome) throw new AppError('source_failed', outcome.error);
  if (!timed(outcome.frames)) return { replayable: false, reason: noTimeReason };
  const extraction = seriesOf(outcome.frames, spec.value);
  const [problem] = extraction.problems;
  if (problem !== undefined && extraction.series.length === 0)
    return { replayable: false, reason: problem };
  const window = { from: request.from, to: request.to, stepMs };
  const series = withinBudget(replaySeries(spec, extraction.series, window));
  return { replayable: true, ...window, series, truncated: extraction.truncated };
}
