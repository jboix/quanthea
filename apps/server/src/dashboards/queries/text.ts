/**
 * The query text builders write: names checked against strict patterns and quoted, literals
 * escaped for their language, and variables left as references the binder fills in.
 */
import type { Filter } from './fields.ts';

/** Why a request cannot be built, in words the model can act on. */
export class QueryError extends Error {
  /**
   * Creates the error.
   *
   * @param message - What is wrong, and how to fix it.
   */
  constructor(message: string) {
    super(message);
    this.name = 'QueryError';
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
 * @throws {QueryError} When it is not a metric name.
 */
export function metricName(metric: string): string {
  if (!/^[A-Za-z_:][A-Za-z0-9_:]*$/.test(metric)) {
    throw new QueryError(`"${metric}" is not a metric name.`);
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
