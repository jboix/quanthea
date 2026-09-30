/**
 * Query templates in a spec. A template names its connector and is written in the connector's
 * language; the server binds the variables. HTTP templates arrive with their connector.
 */
import { z } from 'zod';
import { connectorNameSchema } from '../connectors.ts';
import { refIdSchema } from './names.ts';

/** Validates a duration such as `15s`, `5m` or `1h`. */
export const durationSchema = z
  .string()
  .regex(/^\d{1,5}[smhd]$/, 'Use a duration such as 15s, 1m or 1h.');

/** Validates a step: a duration, or an interval variable such as `$interval`. */
const stepSchema = z.union(
  [durationSchema, z.string().regex(/^\$(?:\{[A-Za-z_]\w*\}|[A-Za-z_]\w*)$/)],
  { error: 'Use a duration such as 15s, 1m or 1h, or an interval variable such as $interval.' },
);

/** Validates a PromQL template: an expression, and whether it is instant and its minimum step. */
const promqlQuerySchema = z.strictObject({
  connector: connectorNameSchema,
  language: z.literal('promql'),
  expr: z.string().min(1).max(10_000),
  step: stepSchema.optional(),
  instant: z.boolean().optional(),
});

/** Validates a SQL template: one read statement with `:name` variables. */
const sqlQuerySchema = z.strictObject({
  connector: connectorNameSchema,
  language: z.literal('sql'),
  sql: z.string().min(1).max(20_000),
});

/**
 * Validates a search template in the Elasticsearch and OpenSearch query DSL: an index and a body
 * where a variable is a JSON node such as `{"$var": "service"}`.
 */
const searchQuerySchema = z.strictObject({
  connector: connectorNameSchema,
  language: z.literal('search'),
  index: z.string().min(1).max(500),
  body: z.record(z.string(), z.unknown()),
});

/** Validates a LogQL template: an expression, and whether it is instant and its minimum step. */
const logqlQuerySchema = z.strictObject({
  connector: connectorNameSchema,
  language: z.literal('logql'),
  expr: z.string().min(1).max(10_000),
  step: stepSchema.optional(),
  instant: z.boolean().optional(),
});

/** Validates a query template without a refId, as a query-backed variable uses it. */
export const queryTemplateSchema = z.discriminatedUnion('language', [
  promqlQuerySchema,
  sqlQuerySchema,
  searchQuerySchema,
  logqlQuerySchema,
]);

/** A query template without a refId. */
export type QueryTemplate = z.infer<typeof queryTemplateSchema>;

/** Validates a panel or annotation query: a template with the refId its view binds to. */
export const panelQuerySchema = z.discriminatedUnion('language', [
  promqlQuerySchema.extend({ refId: refIdSchema }),
  sqlQuerySchema.extend({ refId: refIdSchema }),
  searchQuerySchema.extend({ refId: refIdSchema }),
  logqlQuerySchema.extend({ refId: refIdSchema }),
]);

/** A panel or annotation query. */
export type PanelQuery = z.infer<typeof panelQuerySchema>;

/** The names of the query languages, as people read them. */
export const queryLanguageNames: Readonly<Record<QueryTemplate['language'], string>> = {
  sql: 'SQL',
  promql: 'PromQL',
  search: 'Search DSL',
  logql: 'LogQL',
};

/**
 * The text of a query, to show it: the SQL or the expression, or a search's index and body.
 *
 * @param query - The query.
 * @returns The text.
 */
export function queryText(query: QueryTemplate): string {
  if (query.language === 'sql') return query.sql;
  if (query.language === 'search') return `${query.index}\n${JSON.stringify(query.body, null, 2)}`;
  return query.expr;
}

/**
 * The key of the field that holds a query's text, for pointing at it in an error.
 *
 * @param query - The query.
 * @returns `sql`, `expr` or `body`.
 */
export function queryTextKey(query: QueryTemplate): 'sql' | 'expr' | 'body' {
  if (query.language === 'sql') return 'sql';
  return query.language === 'search' ? 'body' : 'expr';
}
