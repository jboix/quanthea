/**
 * Query templates in a spec. A template names its connector and is written in the connector's
 * language; the server binds the variables.
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

/** Validates a JSON pointer (RFC 6901): empty for the whole document, else `/` and the path. */
const jsonPointerSchema = z
  .string()
  .max(500)
  .regex(/^(\/[^/]*)*$/, 'Use a JSON pointer such as /data/items.');

/** Validates how a column of an HTTP response is read. */
const httpFieldSchema = z.strictObject({
  name: z.string().min(1).max(100),
  /** Where the value is in each row, as a JSON pointer from the row. */
  pointer: jsonPointerSchema,
  type: z.enum(['time', 'number', 'string', 'boolean']).optional(),
  /** For a time given as a number: seconds or milliseconds since the epoch. */
  unit: z.enum(['s', 'ms']).optional(),
});

/** Validates how an HTTP response becomes a table: where its rows are, and its columns. */
const httpExtractSchema = z.strictObject({
  /** The array of rows, as a JSON pointer; an object there is one row. */
  rows: jsonPointerSchema.default(''),
  /** The columns; without them, every value of the first rows, nested ones as dotted names. */
  fields: z.array(httpFieldSchema).max(50).optional(),
});

/**
 * Validates an HTTP template: a path and query parameters where `$name` is a variable, a JSON
 * body for a POST with `{"$var": "name"}` nodes, and how the response becomes a table.
 */
const httpQuerySchema = z.strictObject({
  connector: connectorNameSchema,
  language: z.literal('http'),
  method: z.enum(['GET', 'POST']).default('GET'),
  path: z.string().min(1).max(2000),
  query: z.record(z.string().max(100), z.string().max(2000)).optional(),
  body: z.record(z.string(), z.unknown()).optional(),
  extract: httpExtractSchema.default({ rows: '' }),
});

/**
 * Validates a Redis or Valkey template: one read command and its arguments, where `$name` is a
 * variable. The server checks the command against the commands a query may run.
 */
const redisQuerySchema = z.strictObject({
  connector: connectorNameSchema,
  language: z.literal('redis'),
  command: z.string().regex(/^[A-Za-z]{2,20}$/, 'Name one command, such as ZREVRANGE.'),
  args: z.array(z.string().max(1000)).max(50).default([]),
});

/**
 * Validates a MongoDB template: a collection and an aggregation pipeline in Extended JSON, with
 * `{"$var": "name"}` nodes. The server refuses stages that write and operators that run JavaScript.
 */
const mongodbQuerySchema = z.strictObject({
  connector: connectorNameSchema,
  language: z.literal('mongodb'),
  collection: z.string().min(1).max(120),
  pipeline: z.array(z.record(z.string(), z.unknown())).max(50),
});

/** Validates a query template without a refId, as a query-backed variable uses it. */
export const queryTemplateSchema = z.discriminatedUnion('language', [
  promqlQuerySchema,
  sqlQuerySchema,
  searchQuerySchema,
  logqlQuerySchema,
  httpQuerySchema,
  redisQuerySchema,
  mongodbQuerySchema,
]);

/** A query template without a refId. */
export type QueryTemplate = z.infer<typeof queryTemplateSchema>;

/** Validates a panel or annotation query: a template with the refId its view binds to. */
export const panelQuerySchema = z.discriminatedUnion('language', [
  promqlQuerySchema.extend({ refId: refIdSchema }),
  sqlQuerySchema.extend({ refId: refIdSchema }),
  searchQuerySchema.extend({ refId: refIdSchema }),
  logqlQuerySchema.extend({ refId: refIdSchema }),
  httpQuerySchema.extend({ refId: refIdSchema }),
  redisQuerySchema.extend({ refId: refIdSchema }),
  mongodbQuerySchema.extend({ refId: refIdSchema }),
]);

/** A panel or annotation query. */
export type PanelQuery = z.infer<typeof panelQuerySchema>;

/** The names of the query languages, as people read them. */
export const queryLanguageNames: Readonly<Record<QueryTemplate['language'], string>> = {
  sql: 'SQL',
  promql: 'PromQL',
  search: 'Search DSL',
  logql: 'LogQL',
  http: 'HTTP',
  redis: 'Redis commands',
  mongodb: 'MongoDB aggregation',
};

/**
 * The text of a query, to show it: the SQL or the expression, a search's index and body, an HTTP
 * request's method, path and parameters, a Redis command, or a MongoDB collection and pipeline.
 *
 * @param query - The query.
 * @returns The text.
 */
export function queryText(query: QueryTemplate): string {
  if (query.language === 'sql') return query.sql;
  if (query.language === 'search') return `${query.index}\n${JSON.stringify(query.body, null, 2)}`;
  if (query.language === 'http') return httpText(query);
  if (query.language === 'redis') return [query.command, ...query.args].join(' ');
  if (query.language === 'mongodb')
    return `${query.collection}\n${JSON.stringify(query.pipeline, null, 2)}`;
  return query.expr;
}

/**
 * The text of an HTTP query: the request line with its parameters, then the body if any.
 *
 * @param query - The query.
 * @returns The text.
 */
function httpText(query: Extract<QueryTemplate, { language: 'http' }>): string {
  const parameters = Object.entries(query.query ?? {}).map(([name, value]) => `${name}=${value}`);
  const line = `${query.method} ${query.path}${parameters.length > 0 ? `?${parameters.join('&')}` : ''}`;
  return query.body === undefined ? line : `${line}\n${JSON.stringify(query.body, null, 2)}`;
}

/**
 * The key of the field that holds a query's text, for pointing at it in an error.
 *
 * @param query - The query.
 * @returns `sql`, `expr`, `body`, `path`, `command` or `pipeline`.
 */
export function queryTextKey(
  query: QueryTemplate,
): 'sql' | 'expr' | 'body' | 'path' | 'command' | 'pipeline' {
  if (query.language === 'sql') return 'sql';
  if (query.language === 'http') return 'path';
  if (query.language === 'redis') return 'command';
  if (query.language === 'mongodb') return 'pipeline';
  return query.language === 'search' ? 'body' : 'expr';
}
