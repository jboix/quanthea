/** Binds a query template for its language. */
import type { BoundQuery, TimeRange } from '../connectors/_shared/index.ts';
import { bindHttp, type HttpTemplate } from './http-binder.ts';
import { sqlIntervalWithin } from './interval.ts';
import { bindLogql } from './logql-binder.ts';
import { bindMongodb, type MongodbTemplate } from './mongodb-binder.ts';
import { bindPromql, type PromqlTemplate } from './promql-binder.ts';
import type { ExpressionRun } from './promql-step.ts';
import { bindRedis, type RedisTemplate } from './redis-binder.ts';
import {
  bindSearch,
  type SearchBinding,
  type SearchTemplate,
  searchInterval,
} from './search-binder.ts';
import { bindSql } from './sql-binder.ts';
import type { SqlFlavor } from './sql-dialects.ts';
import type { Variables } from './variables.ts';

/** A query as a dashboard or the agent writes it: a template in one language. */
export type QueryTemplate =
  | { readonly language: 'sql'; readonly sql: string }
  | ({ readonly language: 'promql' } & PromqlTemplate)
  | ({ readonly language: 'logql' } & PromqlTemplate)
  | ({ readonly language: 'search' } & SearchTemplate)
  | ({ readonly language: 'http' } & HttpTemplate)
  | ({ readonly language: 'redis' } & RedisTemplate)
  | ({ readonly language: 'mongodb' } & MongodbTemplate);

/** The most points one Prometheus or Loki series may have, whatever the row limit. */
export const maxPromqlPoints = 11_000;

/** What binding depends on beyond the template: the connector's dialect and the point limit. */
export interface BindOptions {
  /** The SQL dialect of the connector, with its styles for `ansi`. */
  readonly dialect?: SqlFlavor | undefined;
  /** The most points a PromQL or LogQL series may have, which sets the step. */
  readonly maxPoints?: number;
  /** Whether the connector shows its source's own objects: dot indices, `system.` collections. */
  readonly showSystem?: boolean | undefined;
  /** Whether the connector allows a search a script of its own in its two bucket aggregations. */
  readonly bucketScripts?: boolean | undefined;
  /**
   * The interval the charts are cut into, such as `1h`, when the caller chose one: the step of
   * PromQL and LogQL, `__interval` of a search and of SQL, `__interval_ms` of MongoDB. Without it
   * each language picks its own from the time range.
   */
  readonly interval?: string | undefined;
  /**
   * The most points a series of the chart can show, for a time chart: when no interval was
   * chosen, the interval each language picks is raised until the time range has no more points
   * than that. Without it nothing is raised.
   */
  readonly chartPoints?: number | undefined;
  /**
   * Whether a search's date histogram keeps only the buckets it has, as the query wrote it,
   * instead of being filled over the time range. An alert reads its result that way.
   */
  readonly sparse?: boolean | undefined;
}

/**
 * The interval a bucketed language binds: the chosen one, else, for a chart with room for a
 * number of points, the one the language would pick, raised to fit them.
 *
 * @param language - The language: SQL, or a search or MongoDB, which pick alike.
 * @param timeRange - The time range.
 * @param options - The chosen interval and the chart's points, each if given.
 * @returns The interval to bind, or `undefined` to let the language pick as usual.
 */
function bucketInterval(
  language: 'sql' | 'search' | 'mongodb',
  timeRange: TimeRange,
  options: BindOptions,
): string | undefined {
  const { interval, chartPoints } = options;
  if (interval !== undefined || chartPoints === undefined) return interval;
  if (language === 'sql') return sqlIntervalWithin(timeRange, chartPoints);
  return searchInterval(timeRange, chartPoints);
}

/**
 * What a PromQL or LogQL expression is bound over: the point limit, the chosen interval, and the
 * points the chart can show when no interval was chosen.
 *
 * @param timeRange - The time range.
 * @param options - The point limit, the chosen interval and the chart's points, each if given.
 * @returns The run of the expression.
 */
function expressionRun(timeRange: TimeRange, options: BindOptions): ExpressionRun {
  const { interval } = options;
  const chartPoints = interval === undefined ? options.chartPoints : undefined;
  return { timeRange, maxPoints: options.maxPoints ?? maxPromqlPoints, interval, chartPoints };
}

/**
 * What a search is bound with: the connector's system indices and bucket scripts, the interval of
 * its buckets, and whether its histograms stay as written.
 *
 * @param timeRange - The time range.
 * @param options - What binding depends on.
 * @returns The search's binding.
 */
function searchBinding(timeRange: TimeRange, options: BindOptions): SearchBinding {
  const interval = bucketInterval('search', timeRange, options);
  const { showSystem, bucketScripts, sparse } = options;
  return { showSystem, bucketScripts, interval, sparse };
}

/**
 * Binds a template: checks its variables and its statement, and substitutes the values safely.
 *
 * @param template - The template.
 * @param variables - The variable values.
 * @param timeRange - The time range.
 * @param options - The SQL dialect (PostgreSQL when not given), the point limit of series, the
 *   interval the charts are cut into, when one was chosen, and the points a chart can show.
 * @returns The bound query.
 * @throws {QueryError} `invalid` for an unknown or misplaced variable, a SQL template that is not
 *   one read statement, or a search body with a script its connector does not allow.
 */
export function bindTemplate(
  template: QueryTemplate,
  variables: Variables,
  timeRange: TimeRange,
  options: BindOptions = {},
): BoundQuery {
  const { showSystem } = options;
  const bucketed = (language: 'sql' | 'search' | 'mongodb') =>
    bucketInterval(language, timeRange, options);
  switch (template.language) {
    case 'sql':
      return bindSql(
        template.sql,
        variables,
        timeRange,
        options.dialect ?? 'postgres',
        bucketed('sql'),
      );
    case 'search':
      return bindSearch(template, variables, timeRange, searchBinding(timeRange, options));
    case 'logql':
      return bindLogql(template, variables, expressionRun(timeRange, options));
    case 'http':
      return bindHttp(template, variables, timeRange);
    case 'redis':
      return bindRedis(template, variables, timeRange);
    case 'mongodb':
      return bindMongodb(template, variables, timeRange, showSystem, bucketed('mongodb'));
    default:
      return bindPromql(template, variables, expressionRun(timeRange, options));
  }
}
