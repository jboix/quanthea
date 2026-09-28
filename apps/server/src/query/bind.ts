/** Binds a query template for its language. */
import type { BoundQuery, TimeRange } from '../connectors/_shared/index.ts';
import { bindPromql, type PromqlTemplate } from './promql-binder.ts';
import { bindSql } from './sql-binder.ts';
import type { Variables } from './variables.ts';

/** A query as a dashboard or the agent writes it: a template in one language. */
export type QueryTemplate =
  | { readonly language: 'sql'; readonly sql: string }
  | ({ readonly language: 'promql' } & PromqlTemplate);

/** The most points one Prometheus series may have, whatever the row limit. */
export const maxPromqlPoints = 11_000;

/**
 * Binds a template: checks its variables and its statement, and substitutes the values safely.
 *
 * @param template - The template.
 * @param variables - The variable values.
 * @param timeRange - The time range.
 * @param maxPoints - The most points a PromQL series may have, which sets the step.
 * @returns The bound query.
 * @throws {QueryError} `invalid` for an unknown or misplaced variable, or a SQL template that is
 *   not one read statement.
 */
export function bindTemplate(
  template: QueryTemplate,
  variables: Variables,
  timeRange: TimeRange,
  maxPoints = maxPromqlPoints,
): BoundQuery {
  if (template.language === 'sql') return bindSql(template.sql, variables, timeRange);
  return bindPromql(template, variables, timeRange, maxPoints);
}
