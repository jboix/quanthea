/**
 * What the search builders take, for Elasticsearch and OpenSearch: an index, a time field, filters
 * on document fields, and what to measure. Field names are paths such as `data.error_type`.
 */
import { z } from 'zod';
import {
  connectorSchema,
  durationSchema,
  fieldPathSchema,
  pathFilterSchema,
  pathFiltersSchema,
} from './fields.ts';

/** What a search measures; count needs no field. Percentiles give a column per percent. */
export const searchMeasureSchema = z
  .strictObject({
    fn: z.enum(['count', 'sum', 'avg', 'min', 'max', 'cardinality', 'percentiles']),
    field: fieldPathSchema.optional(),
    percents: z.array(z.number().gt(0).lt(100)).min(1).max(4).optional(),
  })
  .default({ fn: 'count' });

/** What a search measures. */
export type SearchMeasure = z.output<typeof searchMeasureSchema>;

/** What every search builder takes. */
const searchBase = {
  connector: connectorSchema,
  index: z.string().min(1).max(500),
  time: fieldPathSchema.default('@timestamp'),
  filters: pathFiltersSchema,
};

/** A measure over time, split by the values of a field when `by` is given. */
const searchSeriesSchema = z.strictObject({
  kind: z.literal('search-series'),
  ...searchBase,
  measure: searchMeasureSchema,
  by: fieldPathSchema.optional(),
  limit: z.int().min(1).max(50).default(10),
  interval: durationSchema.optional(),
});

/**
 * The share of the documents matching `match` among those matching `of` (every document when
 * empty), over time or over the whole range, split by a field when `by` is given.
 */
const searchRatioSchema = z.strictObject({
  kind: z.literal('search-ratio'),
  ...searchBase,
  match: z.array(pathFilterSchema).min(1).max(5),
  of: pathFiltersSchema,
  over: z.enum(['time', 'range']).default('time'),
  by: fieldPathSchema.optional(),
  complement: z.boolean().default(false),
  counts: z.boolean().default(false),
  limit: z.int().min(1).max(100).default(10),
  interval: durationSchema.optional(),
});

/** A measure by the values of a field, largest first, split again by `series` when given. */
const searchBreakdownSchema = z.strictObject({
  kind: z.literal('search-breakdown'),
  ...searchBase,
  by: fieldPathSchema,
  series: fieldPathSchema.optional(),
  measure: searchMeasureSchema,
  limit: z.int().min(1).max(100).default(10),
});

/** One number over the range. */
const searchStatSchema = z.strictObject({
  kind: z.literal('search-stat'),
  ...searchBase,
  measure: searchMeasureSchema,
});

/** How a numeric field's values spread: the documents in each bin of `width`. */
const searchHistogramSchema = z.strictObject({
  kind: z.literal('search-histogram'),
  ...searchBase,
  field: fieldPathSchema,
  width: z.number().positive(),
});

/** The latest documents, newest first. */
const searchRowsSchema = z.strictObject({
  kind: z.literal('search-rows'),
  ...searchBase,
  fields: z.array(fieldPathSchema).min(1).max(20),
  limit: z.int().min(1).max(100).default(20),
});

/** The search builders' schemas, by kind. */
export const searchBuilderSchemas = {
  'search-series': searchSeriesSchema,
  'search-ratio': searchRatioSchema,
  'search-breakdown': searchBreakdownSchema,
  'search-stat': searchStatSchema,
  'search-histogram': searchHistogramSchema,
  'search-rows': searchRowsSchema,
} as const;
