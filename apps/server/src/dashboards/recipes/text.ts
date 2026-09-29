/**
 * The query text recipes write: names checked against strict patterns and quoted, literals
 * escaped for their language, and variables left as references the binder fills in.
 */
import type { Filter } from './request.ts';

/** Why a request cannot be expanded, in words the model can act on. */
export class RecipeError extends Error {
  /**
   * Creates the error.
   *
   * @param message - What is wrong, and how to fix it.
   */
  constructor(message: string) {
    super(message);
    this.name = 'RecipeError';
  }
}

/** A variable reference, such as `$service`. */
const variableReference = /^\$([A-Za-z_]\w*)$/;

/**
 * The variable a value names, if it is a reference such as `$service`.
 *
 * @param value - The value.
 * @returns The variable name, or `undefined` for a literal.
 */
export function variableOf(value: string): string | undefined {
  return variableReference.exec(value)?.[1];
}

/**
 * Checks a Prometheus metric name.
 *
 * @param metric - The name.
 * @returns The name.
 * @throws {RecipeError} When it is not a metric name.
 */
export function metricName(metric: string): string {
  if (!/^[A-Za-z_:][A-Za-z0-9_:]*$/.test(metric)) {
    throw new RecipeError(`"${metric}" is not a metric name.`);
  }
  return metric;
}

/**
 * A PromQL matcher. A literal is a quoted, escaped string; a variable stays `"$name"` for the
 * binder, which escapes its value.
 *
 * @param filter - The filter.
 * @returns Such as `service="checkout-svc"`.
 */
export function promqlMatcher(filter: Filter): string {
  const quoted = variableOf(filter.value) ? `"${filter.value}"` : JSON.stringify(filter.value);
  return `${filter.field}${filter.op}${quoted}`;
}

/**
 * A metric selector with its matchers.
 *
 * @param metric - The metric.
 * @param filters - The filters.
 * @returns Such as `http_requests_total{env="prod"}`.
 */
export function selector(metric: string, filters: readonly Filter[]): string {
  const matchers = filters.map(promqlMatcher).join(',');
  return matchers === '' ? metricName(metric) : `${metricName(metric)}{${matchers}}`;
}

/**
 * The `by (...)` clause of an aggregation.
 *
 * @param labels - The labels.
 * @returns Such as ` by (service)`, or nothing.
 */
export function byClause(labels: readonly string[]): string {
  return labels.length === 0 ? '' : ` by (${labels.join(', ')})`;
}

/**
 * A quoted SQL identifier, or a schema and a table.
 *
 * @param name - The name, checked by the request schema.
 * @returns Such as `"orders"` or `"shop"."orders"`.
 */
export function sqlName(name: string): string {
  return name
    .split('.')
    .map((part) => `"${part}"`)
    .join('.');
}

/**
 * A SQL string literal.
 *
 * @param value - The value.
 * @returns The quoted value, with quotes doubled.
 */
export function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** The SQL operator of each filter operator, for a literal and for a variable. */
const sqlOperators: Readonly<Record<Filter['op'], { literal: string; variable: string }>> = {
  '=': { literal: '=', variable: 'IN' },
  '!=': { literal: '<>', variable: 'NOT IN' },
  '=~': { literal: '~', variable: '~' },
  '!~': { literal: '!~', variable: '!~' },
};

/**
 * A SQL condition. A variable is bound (`:name`); equality with a variable uses `IN`, so a
 * multi-value variable works.
 *
 * @param filter - The filter.
 * @returns Such as `"status" = 'failed'` or `"service" IN (:service)`.
 */
export function sqlCondition(filter: Filter): string {
  const operator = sqlOperators[filter.op];
  const variable = variableOf(filter.value);
  const column = sqlName(filter.field);
  if (variable === undefined) return `${column} ${operator.literal} ${sqlString(filter.value)}`;
  const bound = operator.variable.endsWith('IN') ? `(:${variable})` : `:${variable}`;
  return `${column} ${operator.variable} ${bound}`;
}

/**
 * The WHERE clause of a SQL recipe: the time range when a time column is given, and the filters.
 *
 * @param time - The timestamp column, if any.
 * @param filters - The filters.
 * @returns Such as ` WHERE "created_at" BETWEEN :__from AND :__to AND "status" = 'failed'`.
 */
export function sqlWhere(time: string | undefined, filters: readonly Filter[]): string {
  const range = time === undefined ? [] : [`${sqlName(time)} BETWEEN :__from AND :__to`];
  const conditions = [...range, ...filters.map(sqlCondition)];
  return conditions.length === 0 ? '' : ` WHERE ${conditions.join(' AND ')}`;
}

/**
 * A duration for SQL: a literal interval, or a bound interval variable.
 *
 * @param duration - Such as `5m` or `$interval`.
 * @returns Such as `'5m'::interval` or `:interval::interval`.
 */
export function sqlInterval(duration: string): string {
  const variable = variableOf(duration);
  return variable === undefined ? `${sqlString(duration)}::interval` : `:${variable}::interval`;
}
