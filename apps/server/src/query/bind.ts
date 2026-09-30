/** Binds a query template for its language. */
import type { BoundQuery, SqlDialect, TimeRange } from '../connectors/_shared/index.ts';
import { bindPromql, type PromqlTemplate } from './promql-binder.ts';
import { bindSql } from './sql-binder.ts';
import type { Variables } from './variables.ts';

/** A query as a dashboard or the agent writes it: a template in one language. */
export type QueryTemplate =
  | { readonly language: 'sql'; readonly sql: string }
  | ({ readonly language: 'promql' } & PromqlTemplate);

/** The most points one Prometheus series may have, whatever the row limit. */
export const maxPromqlPoints = 11_000;

/** What binding depends on beyond the template: the connector's dialect and the point limit. */
export interface BindOptions {
  /** The SQL dialect of the connector. */
  readonly dialect?: SqlDialect | undefined;
  /** The most points a PromQL series may have, which sets the step. */
  readonly maxPoints?: number;
}

/**
 * Binds a template: checks its variables and its statement, and substitutes the values safely.
 *
 * @param template - The template.
 * @param variables - The variable values.
 * @param timeRange - The time range.
 * @param options - The SQL dialect (PostgreSQL when not given) and the PromQL point limit.
 * @returns The bound query.
 * @throws {QueryError} `invalid` for an unknown or misplaced variable, or a SQL template that is
 *   not one read statement.
 */
export function bindTemplate(
  template: QueryTemplate,
  variables: Variables,
  timeRange: TimeRange,
  options: BindOptions = {},
): BoundQuery {
  if (template.language === 'sql')
    return bindSql(template.sql, variables, timeRange, options.dialect ?? 'postgres');
  return bindPromql(template, variables, timeRange, options.maxPoints ?? maxPromqlPoints);
}
