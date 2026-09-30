/** Binds a query template for its language. */
import type { BoundQuery, SqlDialect, TimeRange } from '../connectors/_shared/index.ts';
import { bindLogql } from './logql-binder.ts';
import { bindPromql, type PromqlTemplate } from './promql-binder.ts';
import { bindSearch, type SearchTemplate } from './search-binder.ts';
import { bindSql } from './sql-binder.ts';
import type { Variables } from './variables.ts';

/** A query as a dashboard or the agent writes it: a template in one language. */
export type QueryTemplate =
  | { readonly language: 'sql'; readonly sql: string }
  | ({ readonly language: 'promql' } & PromqlTemplate)
  | ({ readonly language: 'logql' } & PromqlTemplate)
  | ({ readonly language: 'search' } & SearchTemplate);

/** The most points one Prometheus or Loki series may have, whatever the row limit. */
export const maxPromqlPoints = 11_000;

/** What binding depends on beyond the template: the connector's dialect and the point limit. */
export interface BindOptions {
  /** The SQL dialect of the connector. */
  readonly dialect?: SqlDialect | undefined;
  /** The most points a PromQL or LogQL series may have, which sets the step. */
  readonly maxPoints?: number;
}

/**
 * Binds a template: checks its variables and its statement, and substitutes the values safely.
 *
 * @param template - The template.
 * @param variables - The variable values.
 * @param timeRange - The time range.
 * @param options - The SQL dialect (PostgreSQL when not given) and the point limit of series.
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
  switch (template.language) {
    case 'sql':
      return bindSql(template.sql, variables, timeRange, options.dialect ?? 'postgres');
    case 'search':
      return bindSearch(template, variables, timeRange);
    case 'logql':
      return bindLogql(template, variables, timeRange, maxPoints);
    default:
      return bindPromql(template, variables, timeRange, maxPoints);
  }
}
