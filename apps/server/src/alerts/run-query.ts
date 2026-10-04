/**
 * Runs an alert's query through the query engine, as panels run theirs: the fixed variables bound,
 * the connector's guardrails, row limit and timeout applied. No model sees the result.
 */
import type { AlertSpec, PanelQuery } from '@quanthea/shared';
import { AppError } from '../lib/errors.ts';
import type { QueryExecutor, QuerySource } from '../query/executor.ts';
import { QueryError } from '../query/query-error.ts';
import type { QueryOutcome } from './observe.ts';
import { alertVariables } from './validate.ts';

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
 * Runs the query of a spec over a window.
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
    });
    return { frames: result.frames };
  } catch (error) {
    if (error instanceof QueryError) return { error: error.safeMessage };
    if (error instanceof AppError) return { error: error.message };
    throw error;
  }
}
