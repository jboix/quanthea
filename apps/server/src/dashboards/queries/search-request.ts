/**
 * What the search builders take, for Elasticsearch and OpenSearch: an index, a time field, filters
 * on document fields, and what to measure. Field names are paths such as `data.error_type`.
 */
import { z } from 'zod';
import { connectorSchema, durationSchema, fieldPathSchema } from './fields.ts';
import { searchFilterSchema, searchFiltersSchema } from './search-filters.ts';

/** A name for a column a builder makes: it names an aggregation too, so it is checked in code. */
const columnNameSchema = z.string().min(1).max(40);

/** A named group of documents, in place of the values of a field: those matching its filters. */
const searchGroupSchema = z.strictObject({
  name: z.string().min(1).max(40),
  filters: z.array(searchFilterSchema).min(1).max(5),
});

/** Named groups, in place of a field, in the order they are shown. */
const searchGroupsSchema = z.array(searchGroupSchema).min(2).max(20).optional();

/** A named group of documents. */
export type SearchGroup = z.output<typeof searchGroupSchema>;

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
  filters: searchFiltersSchema,
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
  match: z.array(searchFilterSchema).min(1).max(5),
  of: searchFiltersSchema,
  over: z.enum(['time', 'range']).default('time'),
  by: fieldPathSchema.optional(),
  complement: z.boolean().default(false),
  counts: z.boolean().default(false),
  limit: z.int().min(1).max(100).default(10),
  interval: durationSchema.optional(),
});

/**
 * A measure by the values of a field, largest first, split again by `series` when given. With
 * `other`, a count adds a row "Other" for the documents outside the values kept.
 */
const searchBreakdownSchema = z.strictObject({
  kind: z.literal('search-breakdown'),
  ...searchBase,
  by: fieldPathSchema,
  series: fieldPathSchema.optional(),
  measure: searchMeasureSchema,
  limit: z.int().min(1).max(100).default(10),
  other: z.boolean().default(false),
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

/** The latest documents, newest first, or the oldest first with `oldest`, as columns in order. */
const searchRowsSchema = z.strictObject({
  kind: z.literal('search-rows'),
  ...searchBase,
  fields: z.array(fieldPathSchema).min(1).max(20),
  limit: z.int().min(1).max(500).default(20),
  oldest: z.boolean().default(false),
});

/**
 * One column of a search table: a count, a metric or one percentile of the documents of a group
 * that match its own filters, or the ratio of two other columns (`part` over `whole`, every
 * document of the group when `whole` is left out).
 */
const searchColumnSchema = z.strictObject({
  name: columnNameSchema,
  fn: z
    .enum(['count', 'sum', 'avg', 'min', 'max', 'cardinality', 'percentile', 'ratio'])
    .default('count'),
  field: fieldPathSchema.optional(),
  percent: z.number().gt(0).lt(100).optional(),
  filters: z.array(searchFilterSchema).max(5).default([]),
  part: columnNameSchema.optional(),
  whole: columnNameSchema.optional(),
  complement: z.boolean().default(false),
});

/** A column of a search table. */
export type SearchColumn = z.output<typeof searchColumnSchema>;

/**
 * A table of named columns by the values of one to three fields, or by named `groups`, sorted by
 * one of its columns, largest first unless `ascending`. With `other`, a table by fields ends with
 * a row "Other" holding the documents outside the groups kept, in the plain count columns.
 */
const searchTableSchema = z.strictObject({
  kind: z.literal('search-table'),
  ...searchBase,
  by: z.array(fieldPathSchema).min(1).max(3).optional(),
  groups: searchGroupsSchema,
  columns: z.array(searchColumnSchema).min(1).max(8),
  sort: columnNameSchema.optional(),
  ascending: z.boolean().default(false),
  limit: z.int().min(1).max(500).default(10),
  other: z.boolean().default(false),
});

/** The search builders' schemas, by kind. */
export const searchBuilderSchemas = {
  'search-series': searchSeriesSchema,
  'search-ratio': searchRatioSchema,
  'search-breakdown': searchBreakdownSchema,
  'search-stat': searchStatSchema,
  'search-histogram': searchHistogramSchema,
  'search-rows': searchRowsSchema,
  'search-table': searchTableSchema,
} as const;
