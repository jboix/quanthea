/**
 * Runs an alert's queries through the query engine, as panels run theirs: the fixed variables
 * bound, each connector's guardrails, row limit and timeout applied. No model sees the result.
 */
import type { AlertSpec, Frame, PanelQuery } from '@quanthea/shared';
import { AppError } from '../lib/errors.ts';
import type { QueryExecutor, QuerySource } from '../query/executor.ts';
import { QueryError } from '../query/query-error.ts';
import { historyQuery, historyWindowAt } from './history.ts';
import type { QueryOutcome } from './observe.ts';
import { alertInterval, alertVariables, windowAt } from './validate.ts';

/** What running an alert's query needs. */
export interface AlertQueryDependencies {
  /** Opens a connector by name. */
  readonly openSource: (name: string) => Promise<QuerySource>;
  /** Runs queries. */
  readonly executor: QueryExecutor;
}

/** A window of time, in epoch milliseconds. */
export interface TimeWindow {
  /** The start. */
  readonly from: number;
  /** The end. */
  readonly to: number;
}

/**
 * Runs the query of a spec over a window, its time buckets bound to the alert's interval whatever
 * the length of the window. A search's date histogram is not filled over the window, as a
 * panel's is: an empty bucket would read as a count of 0 where the alert reads no data.
 *
 * @param dependencies - The connectors and the executor.
 * @param spec - The spec.
 * @param window - The window.
 * @param query - The query to run in place of the spec's, such as one with a replay's step.
 * @returns The frames, or why the query failed, in words that quote no data.
 * @throws {unknown} Anything that is not a query or application error.
 */
export async function runAlertQuery(
  dependencies: AlertQueryDependencies,
  spec: AlertSpec,
  window: TimeWindow,
  query: PanelQuery = spec.query,
): Promise<QueryOutcome> {
  try {
    const source = await dependencies.openSource(query.connector);
    const result = await dependencies.executor.run(source, {
      refId: query.refId,
      template: query,
      variables: alertVariables(spec),
      timeRange: { from: new Date(window.from), to: new Date(window.to) },
      interval: alertInterval(spec, query),
      // An alert reads the buckets a search has: a stretch without a document is no data, not 0.
      sparse: true,
    });
    return { frames: result.frames };
  } catch (error) {
    if (error instanceof QueryError) return { error: error.safeMessage };
    if (error instanceof AppError) return { error: error.message };
    throw error;
  }
}

/**
 * Runs the second query of a ratio over a window, through the query engine as the first runs:
 * its own connector's guardrails, row limit, timeout and visibility.
 *
 * @param dependencies - The connectors and the executor.
 * @param spec - The spec.
 * @param window - The window.
 * @param query - The query to run in place of the spec's second, such as one with a replay's step.
 * @returns Its frames, nothing for a spec without a second query, or why it failed.
 */
export async function runDivisorQuery(
  dependencies: AlertQueryDependencies,
  spec: AlertSpec,
  window: TimeWindow,
  query: PanelQuery | undefined = spec.dividedBy?.query,
): Promise<readonly Frame[] | undefined | { readonly error: string }> {
  if (!query) return undefined;
  const outcome = await runAlertQuery(dependencies, spec, window, query);
  return 'error' in outcome ? { error: `The second query: ${outcome.error}` } : outcome.frames;
}

/**
 * Runs the history query of an evaluation, for a condition that reads history.
 *
 * @param dependencies - The connectors and the executor.
 * @param spec - The spec.
 * @param at - The evaluation.
 * @returns Its frames, nothing for a condition without history, or why it failed.
 */
async function runHistoryQuery(
  dependencies: AlertQueryDependencies,
  spec: AlertSpec,
  at: number,
): Promise<readonly Frame[] | undefined | { readonly error: string }> {
  const before = historyWindowAt(spec, at);
  if (!before) return undefined;
  const outcome = await runAlertQuery(dependencies, spec, before, historyQuery(spec));
  return 'error' in outcome ? outcome : outcome.frames;
}

/**
 * Runs what one evaluation of a spec reads: its query over the window ending at an instant, then
 * the second query of a ratio over the same window, then, for a condition that reads history, the
 * history query. They run one after the other, so an evaluation never holds more than one query
 * of a connector at a time.
 *
 * @param dependencies - The connectors and the executor.
 * @param spec - The spec.
 * @param at - The evaluation.
 * @returns The frames of the window, with those of the second query and of the history when the
 *   spec has them, or why a query failed.
 */
export async function runEvaluationQueries(
  dependencies: AlertQueryDependencies,
  spec: AlertSpec,
  at: number,
): Promise<QueryOutcome> {
  const window = windowAt(spec, at);
  const outcome = await runAlertQuery(dependencies, spec, window);
  if ('error' in outcome) return outcome;
  const divisor = await runDivisorQuery(dependencies, spec, window);
  if (divisor && 'error' in divisor) return divisor;
  const history = await runHistoryQuery(dependencies, spec, at);
  if (history && 'error' in history) return history;
  return { frames: outcome.frames, history, divisor };
}
