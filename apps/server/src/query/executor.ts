/**
 * Runs a query template against a connector: binds the variables, applies the guardrails and the
 * timeout, checks the frames the connector returns, and caches the result briefly.
 */
import { type Frame, frameProblems, type Guardrails } from '@querent/shared';
import {
  type BoundQuery,
  ConnectorError,
  type ConnectorInstance,
  type QueryLanguage,
  type SqlDialect,
  type TimeRange,
} from '../connectors/_shared/index.ts';
import { bindTemplate, maxPromqlPoints, type QueryTemplate } from './bind.ts';
import { checkTimeRange } from './guardrails.ts';
import { QueryError } from './query-error.ts';
import type { ResultCache } from './result-cache.ts';
import type { Variables } from './variables.ts';

/** A connector ready to run queries, as the caller resolved it. */
export interface QuerySource {
  /** The connector id, part of the cache key. */
  readonly connectorId: string;
  /** Changes whenever the connector's settings change, so the cache forgets old results. */
  readonly version: number;
  /** The language of the connector's kind. */
  readonly language: QueryLanguage;
  /** The SQL dialect of the connector's kind, when it runs SQL. */
  readonly dialect?: SqlDialect | undefined;
  /** The open connection. */
  readonly instance: ConnectorInstance;
  /** The connector's guardrails. */
  readonly guardrails: Guardrails;
}

/** One query to run. */
export interface QueryRequest {
  /** The name of the result, such as `A`. */
  readonly refId: string;
  /** The template. */
  readonly template: QueryTemplate;
  /** The variable values. */
  readonly variables: Variables;
  /** The time range. */
  readonly timeRange: TimeRange;
  /** Aborted when the caller gives up. */
  readonly signal?: AbortSignal;
}

/** The result of a query. */
export interface QueryResult {
  /** The frames. */
  readonly frames: readonly Frame[];
  /** The query the connector received. */
  readonly bound: BoundQuery;
  /** Whether the frames came from the cache. */
  readonly cached: boolean;
}

/**
 * Binds a template for its language.
 *
 * @param source - The connector.
 * @param request - The query.
 * @returns The bound query.
 * @throws {QueryError} `invalid` when the template is in another language or does not bind.
 */
function bind(source: QuerySource, request: QueryRequest): BoundQuery {
  const { template } = request;
  if (template.language !== source.language) {
    throw new QueryError(
      'invalid',
      `This connector runs ${source.language} queries, not ${template.language}.`,
    );
  }
  const maxPoints = Math.min(source.guardrails.maxRows, maxPromqlPoints);
  return bindTemplate(template, request.variables, request.timeRange, {
    dialect: source.dialect,
    maxPoints,
  });
}

/**
 * Rejects when the signal fires, so a connector that ignores its signal still cannot hold the
 * caller past the timeout.
 *
 * @param signal - The signal.
 * @returns A promise that only rejects.
 */
function whenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const abort = (): void =>
      reject(
        new QueryError('timeout', 'The query ran longer than the timeout, or the caller gave up.'),
      );
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

/**
 * Runs a bound query with the timeout and checks the frames.
 *
 * @param source - The connector.
 * @param request - The query.
 * @param bound - The bound query.
 * @returns The frames.
 * @throws {QueryError} `timeout`, or `connector` wrapping the connector's error or invalid frames.
 */
async function runBound(
  source: QuerySource,
  request: QueryRequest,
  bound: BoundQuery,
): Promise<Frame[]> {
  const { timeoutMs, maxRows } = source.guardrails;
  const signals = [AbortSignal.timeout(timeoutMs), ...(request.signal ? [request.signal] : [])];
  const signal = AbortSignal.any(signals);
  const context = {
    refId: request.refId,
    signal,
    timeoutMs,
    maxRows,
    timeRange: request.timeRange,
  };
  try {
    const frames = await Promise.race([
      source.instance.execute(bound, context),
      whenAborted(signal),
    ]);
    const problems = frames.flatMap((frame) => frameProblems(frame));
    if (problems.length > 0)
      throw new ConnectorError('internal', `The connector returned invalid frames: ${problems[0]}`);
    return frames;
  } catch (error) {
    throw toQueryError(error);
  }
}

/**
 * Turns what a run threw into a QueryError; anything unexpected is rethrown as is.
 *
 * @param error - What was thrown.
 * @returns The QueryError to throw.
 */
function toQueryError(error: unknown): unknown {
  if (!(error instanceof ConnectorError)) return error;
  return new QueryError(
    error.code === 'timeout' ? 'timeout' : 'connector',
    error.safeMessage,
    error,
  );
}

/** Runs queries. */
export interface QueryExecutor {
  /**
   * Runs one query.
   *
   * @param source - The resolved connector.
   * @param request - The query.
   * @returns The frames, the bound query, and whether they were cached.
   * @throws {QueryError} When the query is invalid, refused, too slow, or fails.
   */
  run(source: QuerySource, request: QueryRequest): Promise<QueryResult>;
}

/**
 * Creates the executor.
 *
 * @param cache - The result cache.
 * @returns The executor.
 */
export function createQueryExecutor(cache: ResultCache): QueryExecutor {
  return {
    async run(source, request) {
      checkTimeRange(request.timeRange, source.guardrails);
      const bound = bind(source, request);
      const { from, to } = request.timeRange;
      const key = JSON.stringify([
        source.connectorId,
        source.version,
        request.refId,
        bound,
        from.getTime(),
        to.getTime(),
      ]);
      const cached = cache.get(key);
      if (cached) return { frames: cached, bound, cached: true };
      const frames = await runBound(source, request, bound);
      cache.set(key, frames);
      return { frames, bound, cached: false };
    },
  };
}
