/**
 * What the MongoDB builders take: a collection, a time field, filters on document fields, and what
 * to measure. Field names are paths such as `customer.country`.
 */
import { z } from 'zod';
import {
  connectorSchema,
  durationSchema,
  fieldPathSchema,
  pathFilterSchema,
  pathFiltersSchema,
} from './fields.ts';

/** What a MongoDB builder measures; count needs no field. Percentiles give a column per percent. */
export const mongodbMeasureSchema = z
  .strictObject({
    fn: z.enum(['count', 'sum', 'avg', 'min', 'max', 'count_distinct', 'percentiles']),
    field: fieldPathSchema.optional(),
    percents: z.array(z.number().gt(0).lt(100)).min(1).max(4).optional(),
  })
  .default({ fn: 'count' });

/** What a MongoDB builder measures. */
export type MongodbMeasure = z.output<typeof mongodbMeasureSchema>;

/** A collection name. */
const collectionSchema = z.string().min(1).max(120);

/** What every MongoDB builder takes; the time field keeps documents to the range when given. */
const mongodbBase = {
  connector: connectorSchema,
  collection: collectionSchema,
  time: fieldPathSchema.optional(),
  filters: pathFiltersSchema,
};

/** A measure over time, split by the values of a field when `by` is given. */
const mongodbSeriesSchema = z.strictObject({
  kind: z.literal('mongodb-series'),
  ...mongodbBase,
  time: fieldPathSchema,
  measure: mongodbMeasureSchema,
  by: fieldPathSchema.optional(),
  interval: durationSchema.optional(),
});

/**
 * The share of the documents matching `match` among those matching `of` (every document when
 * empty), over time or over the whole range, split by a field when `by` is given.
 */
const mongodbRatioSchema = z.strictObject({
  kind: z.literal('mongodb-ratio'),
  ...mongodbBase,
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
const mongodbBreakdownSchema = z.strictObject({
  kind: z.literal('mongodb-breakdown'),
  ...mongodbBase,
  by: fieldPathSchema,
  series: fieldPathSchema.optional(),
  measure: mongodbMeasureSchema,
  limit: z.int().min(1).max(100).default(10),
});

/** One number over the range. */
const mongodbStatSchema = z.strictObject({
  kind: z.literal('mongodb-stat'),
  ...mongodbBase,
  measure: mongodbMeasureSchema,
});

/** How a numeric field's values spread: the documents in each bin of `width`. */
const mongodbHistogramSchema = z.strictObject({
  kind: z.literal('mongodb-histogram'),
  ...mongodbBase,
  field: fieldPathSchema,
  width: z.number().positive(),
});

/** The latest documents, newest first when there is a time field. */
const mongodbRowsSchema = z.strictObject({
  kind: z.literal('mongodb-rows'),
  ...mongodbBase,
  fields: z.array(fieldPathSchema).min(1).max(20),
  limit: z.int().min(1).max(200).default(20),
});

/** The MongoDB builders' schemas, by kind. */
export const mongodbBuilderSchemas = {
  'mongodb-series': mongodbSeriesSchema,
  'mongodb-ratio': mongodbRatioSchema,
  'mongodb-breakdown': mongodbBreakdownSchema,
  'mongodb-stat': mongodbStatSchema,
  'mongodb-histogram': mongodbHistogramSchema,
  'mongodb-rows': mongodbRowsSchema,
} as const;
