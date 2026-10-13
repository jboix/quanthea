/** Binds a query template for its language. */
import type { BoundQuery, TimeRange } from '../connectors/_shared/index.ts';
import { bindHttp, type HttpTemplate } from './http-binder.ts';
import { bindLogql } from './logql-binder.ts';
import { bindMongodb, type MongodbTemplate } from './mongodb-binder.ts';
import { bindPromql, type PromqlTemplate } from './promql-binder.ts';
import { bindRedis, type RedisTemplate } from './redis-binder.ts';
import { bindSearch, type SearchTemplate } from './search-binder.ts';
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
  /**
   * The interval the charts are cut into, such as `1h`, when the caller chose one: the step of
   * PromQL and LogQL, `__interval` of a search and of SQL, `__interval_ms` of MongoDB. Without it
   * each language picks its own from the time range.
   */
  readonly interval?: string | undefined;
}

/**
 * Binds a template: checks its variables and its statement, and substitutes the values safely.
 *
 * @param template - The template.
 * @param variables - The variable values.
 * @param timeRange - The time range.
 * @param options - The SQL dialect (PostgreSQL when not given), the point limit of series and
 *   the interval the charts are cut into, when one was chosen.
 * @returns The bound query.
 * @throws {QueryError} `invalid` for an unknown or misplaced variable, a SQL template that is not
 *   one read statement, or a search body with a script.
 */
export function bindTemplate(
  template: QueryTemplate,
  variables: Variables,
  timeRange: TimeRange,
  options: BindOptions = {},
): BoundQuery {
  const maxPoints = options.maxPoints ?? maxPromqlPoints;
  const { interval, showSystem } = options;
  switch (template.language) {
    case 'sql':
      return bindSql(template.sql, variables, timeRange, options.dialect ?? 'postgres', interval);
    case 'search':
      return bindSearch(template, variables, timeRange, showSystem, interval);
    case 'logql':
      return bindLogql(template, variables, timeRange, maxPoints, interval);
    case 'http':
      return bindHttp(template, variables, timeRange);
    case 'redis':
      return bindRedis(template, variables, timeRange);
    case 'mongodb':
      return bindMongodb(template, variables, timeRange, showSystem, interval);
    default:
      return bindPromql(template, variables, timeRange, maxPoints, interval);
  }
}
