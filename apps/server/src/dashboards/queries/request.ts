/**
 * What data a panel asks for: a query builder with its fields, a saved query with its values, or
 * a raw query. Builders write the query, so the model names data rather than writing query text.
 * This is part of the edit tool's input schema, so it stays small: name checks run in code rather
 * than as JSON schema patterns.
 */
import type { SavedQuery } from '@querent/shared';
import { z } from 'zod';
import {
  connectorSchema,
  durationSchema,
  filterSchema,
  filtersSchema,
  nameSchema,
  tableSchema,
} from './fields.ts';
import { searchBuilderSchemas } from './search-request.ts';

/** What every PromQL builder takes. */
const promqlBase = {
  connector: connectorSchema,
  metric: z.string().max(200),
  filters: filtersSchema,
  by: z.array(nameSchema).max(4).default([]),
};

/** A counter's per-second rate. */
const rateSchema = z.strictObject({
  kind: z.literal('rate'),
  ...promqlBase,
  window: durationSchema.default('$__rate_interval'),
});

/** The share of a counter that also matches `match`, such as 5xx over all requests. */
const ratioSchema = z.strictObject({
  kind: z.literal('ratio'),
  ...promqlBase,
  match: z.array(filterSchema).min(1).max(5),
  window: durationSchema.default('$__rate_interval'),
});

/** Percentiles of a histogram. */
const latencySchema = z.strictObject({
  kind: z.literal('latency'),
  ...promqlBase,
  quantiles: z.array(z.number().gt(0).lt(1)).min(1).max(4).default([0.5, 0.95, 0.99]),
  window: durationSchema.default('$__rate_interval'),
});

/** A gauge, aggregated. */
const gaugeSchema = z.strictObject({
  kind: z.literal('gauge'),
  ...promqlBase,
  aggregate: z.enum(['sum', 'avg', 'max', 'min']).default('sum'),
});

/** The top values of a counter over the time range, by label. */
const topSchema = z.strictObject({
  kind: z.literal('top'),
  ...promqlBase,
  by: z.array(nameSchema).min(1).max(4),
  limit: z.int().min(1).max(50).default(10),
});

/** What a SQL builder measures; count needs no column. */
const measureSchema = z
  .strictObject({
    fn: z.enum(['count', 'sum', 'avg', 'min', 'max', 'count_distinct']),
    column: nameSchema.optional(),
  })
  .default({ fn: 'count' });

/** What every SQL builder takes. */
const sqlBase = { connector: connectorSchema, table: tableSchema, filters: filtersSchema };

/** A measure over time, in buckets, split by a column when `by` is given. */
const sqlSeriesSchema = z.strictObject({
  kind: z.literal('sql-series'),
  ...sqlBase,
  time: nameSchema,
  measure: measureSchema,
  by: nameSchema.optional(),
  bucket: durationSchema.default('5m'),
});

/** A measure by the values of a column, kept to the range when `time` is given. */
const sqlBreakdownSchema = z.strictObject({
  kind: z.literal('sql-breakdown'),
  ...sqlBase,
  by: nameSchema,
  time: nameSchema.optional(),
  measure: measureSchema,
  limit: z.int().min(1).max(100).default(10),
});

/** One number, kept to the range when `time` is given. */
const sqlStatSchema = z.strictObject({
  kind: z.literal('sql-stat'),
  ...sqlBase,
  time: nameSchema.optional(),
  measure: measureSchema,
});

/** The latest rows, newest first when `time` is given. */
const sqlRowsSchema = z.strictObject({
  kind: z.literal('sql-rows'),
  ...sqlBase,
  columns: z.array(nameSchema).min(1).max(12),
  time: nameSchema.optional(),
  limit: z.int().min(1).max(200).default(20),
});

/**
 * A raw query, for data no builder gives. A search query is its JSON body as text, with the index
 * apart; an HTTP query is the JSON of its method, path, query, body and extract; a Redis query is
 * the command and its arguments, separated by spaces, or their JSON array when an argument holds a
 * space; a MongoDB query is the JSON of its collection and pipeline.
 */
const rawSchema = z
  .strictObject({
    kind: z.literal('raw'),
    connector: connectorSchema,
    language: z.enum(['sql', 'promql', 'search', 'logql', 'http', 'redis', 'mongodb']),
    query: z.string().min(1).max(10_000),
    index: z.string().min(1).max(500).optional(),
    instant: z.boolean().optional(),
  })
  .refine((raw) => raw.language !== 'search' || raw.index !== undefined, {
    message: 'A search query names its index.',
    path: ['index'],
  });

/** A saved query, by id, with its placeholders filled. */
const savedSchema = z.strictObject({
  kind: z.literal('saved'),
  name: z.string().max(40),
  connector: connectorSchema,
  params: z.record(z.string(), z.string().max(200)).default({}),
});

/** The builders' schemas, by kind. */
export const builderSchemas = {
  rate: rateSchema,
  ratio: ratioSchema,
  latency: latencySchema,
  gauge: gaugeSchema,
  top: topSchema,
  'sql-series': sqlSeriesSchema,
  'sql-breakdown': sqlBreakdownSchema,
  'sql-stat': sqlStatSchema,
  'sql-rows': sqlRowsSchema,
  ...searchBuilderSchemas,
} as const;

/** Validates a data request of any kind. */
export const dataSchema = z.discriminatedUnion('kind', [
  rateSchema,
  ratioSchema,
  latencySchema,
  gaugeSchema,
  topSchema,
  sqlSeriesSchema,
  sqlBreakdownSchema,
  sqlStatSchema,
  sqlRowsSchema,
  ...Object.values(searchBuilderSchemas),
  rawSchema,
  savedSchema,
]);

/** A data request. */
export type DataRequest = z.output<typeof dataSchema>;

/** A data request of one kind. */
export type DataOf<Kind extends DataRequest['kind']> = Extract<DataRequest, { kind: Kind }>;

/** The query builders and saved queries a run may use. */
export interface AvailableQueries {
  /** The builders' kinds. */
  readonly builtIn: readonly string[];
  /** The saved queries. */
  readonly saved: readonly SavedQuery[];
}

/**
 * The data schema of a run: raw queries always, and only the builders and saved queries it may
 * use, so providers that constrain tool input keep the model to them.
 *
 * @param available - The builders and saved queries.
 * @returns The schema.
 */
export function dataSchemaFor(available: AvailableQueries) {
  const builders = Object.entries(builderSchemas)
    .filter(([kind]) => available.builtIn.includes(kind))
    .map(([, schema]) => schema);
  const saved = available.saved.length > 0 ? [savedSchema] : [];
  return z.discriminatedUnion('kind', [rawSchema, ...builders, ...saved]);
}
