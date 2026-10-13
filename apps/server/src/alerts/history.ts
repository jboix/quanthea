/**
 * The history a condition reads besides its window: a comparison with the past reads the same
 * window a period back, a band the baseline before the window. Either is one more query, which
 * runs through the query engine as the alert's own does. A condition reads history at most once.
 */
import {
  type AlertSpec,
  conditionTests,
  durationMs,
  type PanelQuery,
  readsHistory,
} from '@quanthea/shared';
import { type History, measuresOf } from './measure.ts';

/** A span of time, in epoch milliseconds. */
interface Span {
  /** The start. */
  readonly from: number;
  /** The end. */
  readonly to: number;
}

/**
 * The history a spec's condition reads.
 *
 * @param spec - The spec.
 * @returns What its one test with history reads, or `undefined` when no test has any.
 */
export function historyOf(spec: AlertSpec): History | undefined {
  return measuresOf(spec).find((each) => each.history)?.history;
}

/**
 * How many queries one evaluation of a spec runs on its connector.
 *
 * @param spec - The spec, as stored.
 * @returns 2 for a condition that reads history, 1 otherwise.
 */
export function queriesPerEvaluation(spec: Pick<AlertSpec, 'condition'>): number {
  if (!spec.condition) return 1;
  return conditionTests(spec.condition).some(readsHistory) ? 2 : 1;
}

/**
 * The span of time the history query of an evaluation covers.
 *
 * @param spec - The spec.
 * @param at - The evaluation.
 * @returns The evaluation's window a period back, or the baseline that ends where the window
 *   starts; `undefined` for a condition without history.
 */
export function historyWindowAt(spec: AlertSpec, at: number): Span | undefined {
  const history = historyOf(spec);
  if (!history) return undefined;
  const from = at - durationMs(spec.lookback);
  if (history.kind === 'shifted') return { from: from - history.ms, to: at - history.ms };
  return { from: from - history.ms, to: from };
}

/**
 * A query over a range: a PromQL or LogQL query that is never instant, so it returns the points of
 * the range.
 *
 * @param query - The query.
 * @param step - The step to ask for, as a duration; the query's own when left out.
 * @returns The query.
 */
export function rangedQuery(query: PanelQuery, step?: string): PanelQuery {
  if (query.language !== 'promql' && query.language !== 'logql') return query;
  const { instant: _instant, ...ranged } = query;
  return step === undefined ? ranged : { ...ranged, step };
}

/**
 * The query an evaluation reads its history with: the alert's own for the window a period back,
 * and one over the range for a baseline, whose points are what the band is learned from.
 *
 * @param spec - The spec, with a condition that reads history.
 * @returns The query.
 */
export function historyQuery(spec: AlertSpec): PanelQuery {
  return historyOf(spec)?.kind === 'baseline' ? rangedQuery(spec.query) : spec.query;
}

/**
 * The span of time a replay reads before its own, for the history of its steps.
 *
 * @param spec - The spec.
 * @param span - The span the replay reads for its steps' windows.
 * @returns The span before it, ending a millisecond short of it so no point is read twice, or
 *   `undefined` for a condition without history. A comparison with the past further back than the
 *   replay is long reads only as far as its last step looks.
 */
export function historyBefore(spec: AlertSpec, span: Span): Span | undefined {
  const history = historyOf(spec);
  if (!history) return undefined;
  const from = span.from - history.ms;
  const to =
    history.kind === 'shifted' ? Math.min(span.from - 1, span.to - history.ms) : span.from - 1;
  return { from, to };
}
