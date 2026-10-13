/**
 * Runs a query template against a connector: binds the variables, applies the guardrails and the
 * timeout, checks the frames the connector returns, and caches the result briefly.
 */
import { type Frame, frameProblems, type Guardrails, queryBuilders } from '@quanthea/shared';
import {
  type BoundQuery,
  ConnectorError,
  type ConnectorInstance,
  type QueryLanguage,
  type TimeRange,
} from '../connectors/_shared/index.ts';
import { bindTemplate, maxPromqlPoints, type QueryTemplate } from './bind.ts';
import { checkTimeRange } from './guardrails.ts';
import { QueryError } from './query-error.ts';
import type { ResultCache } from './result-cache.ts';
import { checkScope } from './scope/check.ts';
import type { ObjectScope } from './scope/object-scope.ts';
import { narrowSearch } from './scope/search-scope.ts';
import type { SqlFlavor } from './sql-dialects.ts';
import type { Variables } from './variables.ts';

/** A connector ready to run queries, as the caller resolved it. */
export interface QuerySource {
  /** The connector id, part of the cache key. */
  readonly connectorId: string;
  /** Changes whenever the connector's settings change, so the cache forgets old results. */
  readonly version: number;
  /** The language of the connector's kind. */
  readonly language: QueryLanguage;
  /** The SQL dialect of the connector's kind, with its styles for `ansi`, when it runs SQL. */
  readonly dialect?: SqlFlavor | undefined;
  /** The open connection. */
  readonly instance: ConnectorInstance;
  /** The connector's guardrails. */
  readonly guardrails: Guardrails;
  /** Which of the source's objects the connector shows: a query on another is refused. */
  readonly scope: ObjectScope;
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
  /** The interval the charts are cut into, such as `1h`, when the caller chose one. */
  readonly interval?: string | undefined;
  /**
   * The most points a series of the chart can show, when the query draws a time chart: the
   * interval is raised to fit them, unless one was chosen.
   */
  readonly chartPoints?: number | undefined;
  /**
   * Whether a search's date histogram keeps only the buckets it has, instead of being filled
   * over the time range: an alert's evaluation, where a stretch without data is no data.
   */
  readonly sparse?: boolean | undefined;
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
 * What to say when a query is not in its connector's language: the language it speaks and the
 * builders of that language, so whoever wrote the query picks one that runs.
 *
 * @param spoken - The connector's language.
 * @param written - The query's language.
 * @returns The message.
 */
function wrongLanguage(spoken: string, written: string): string {
  const builders = queryBuilders
    .filter((builder) => builder.language === spoken)
    .map((builder) => builder.id);
  const use = builders.length === 0 ? '' : ` Its builders are ${builders.join(', ')}.`;
  return `This connector runs ${spoken} queries, not ${written}.${use}`;
}

/**
 * Binds a template for its language and checks the objects it names.
 *
 * @param source - The connector.
 * @param request - The query.
 * @returns The bound query.
 * @throws {QueryError} `invalid` when the template is in another language, does not bind, or
 *   names an object the connector does not show.
 */
function bind(source: QuerySource, request: QueryRequest): BoundQuery {
  const { template } = request;
  if (template.language !== source.language) {
    throw new QueryError('invalid', wrongLanguage(source.language, template.language));
  }
  const maxPoints = Math.min(source.guardrails.maxRows, maxPromqlPoints);
  const bound = bindTemplate(template, request.variables, request.timeRange, {
    dialect: source.dialect,
    maxPoints,
    showSystem: source.scope.visibility.showSystem,
    interval: request.interval,
    chartPoints: request.chartPoints,
    sparse: request.sparse,
  });
  checkScope(source.scope, bound, source.dialect);
  return bound;
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

/** A bound query as it ran, and its frames. */
interface Ran {
  /** The query the connector received. */
  readonly bound: BoundQuery;
  /** The frames. */
  readonly frames: Frame[];
}

/**
 * The query the connector receives: a search loses the indices its connector does not show, which
 * the source resolves first, so a pattern cannot reach them.
 *
 * @param source - The connector.
 * @param bound - The bound query.
 * @param signal - Aborted on timeout or when the caller gives up.
 * @returns The query to execute.
 */
async function narrowed(
  source: QuerySource,
  bound: BoundQuery,
  signal: AbortSignal,
): Promise<BoundQuery> {
  if (bound.language !== 'search') return bound;
  return Promise.race([
    narrowSearch(source.scope, bound, source.instance, signal),
    whenAborted(signal),
  ]);
}

/**
 * Runs a bound query with the timeout and checks the frames.
 *
 * @param source - The connector.
 * @param request - The query.
 * @param bound - The bound query.
 * @returns The query the connector received and its frames.
 * @throws {QueryError} `invalid` for a search on indices the connector does not show, `timeout`,
 *   or `connector` wrapping the connector's error or invalid frames.
 */
async function runBound(
  source: QuerySource,
  request: QueryRequest,
  bound: BoundQuery,
): Promise<Ran> {
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
    const query = await narrowed(source, bound, signal);
    const frames = await Promise.race([
      source.instance.execute(query, context),
      whenAborted(signal),
    ]);
    const problems = frames.flatMap((frame) => frameProblems(frame));
    if (problems.length > 0)
      throw new ConnectorError('internal', `The connector returned invalid frames: ${problems[0]}`);
    return { bound: query, frames };
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
      const ran = await runBound(source, request, bound);
      cache.set(key, ran.frames);
      return { frames: ran.frames, bound: ran.bound, cached: false };
    },
  };
}
