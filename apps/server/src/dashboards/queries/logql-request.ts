/**
 * What the LogQL builders take, for Loki: the streams by label, the text lines must contain, a
 * parser for fields in the lines, filters on labels and fields, and what to measure.
 */
import { z } from 'zod';
import {
  connectorSchema,
  durationSchema,
  filterSchema,
  filtersSchema,
  nameSchema,
} from './fields.ts';

/** What a LogQL builder measures: lines, or a number read from a field of the lines. */
export const logqlMeasureSchema = z
  .strictObject({
    fn: z.enum(['count', 'rate', 'sum', 'avg', 'min', 'max', 'quantile']),
    field: nameSchema.optional(),
    quantile: z.number().gt(0).lt(1).optional(),
  })
  .default({ fn: 'count' });

/** What a LogQL builder measures. */
export type LogqlMeasure = z.output<typeof logqlMeasureSchema>;

/** What every LogQL builder takes. */
const logqlBase = {
  connector: connectorSchema,
  stream: z.array(filterSchema).min(1).max(10),
  contains: z.array(z.string().min(1).max(200)).max(5).default([]),
  parser: z.enum(['json', 'logfmt']).optional(),
  filters: filtersSchema,
};

/** Lines, or a number from them, over time, one series per value of the `by` labels. */
const logqlSeriesSchema = z.strictObject({
  kind: z.literal('logql-series'),
  ...logqlBase,
  measure: logqlMeasureSchema,
  by: z.array(nameSchema).max(4).default([]),
  window: durationSchema.default('$__interval'),
});

/** The share of the lines that also match `match`, over time or over the range. */
const logqlRatioSchema = z.strictObject({
  kind: z.literal('logql-ratio'),
  ...logqlBase,
  match: z.array(filterSchema).min(1).max(5),
  by: z.array(nameSchema).max(4).default([]),
  over: z.enum(['time', 'range']).default('time'),
  complement: z.boolean().default(false),
  window: durationSchema.default('$__interval'),
});

/** Lines, or a number from them, over the range by label, largest first. */
const logqlBreakdownSchema = z.strictObject({
  kind: z.literal('logql-breakdown'),
  ...logqlBase,
  by: z.array(nameSchema).min(1).max(4),
  measure: logqlMeasureSchema,
  limit: z.int().min(1).max(50).default(10),
});

/** One number over the range. */
const logqlStatSchema = z.strictObject({
  kind: z.literal('logql-stat'),
  ...logqlBase,
  measure: logqlMeasureSchema,
});

/** The latest lines, newest first. */
const logqlLinesSchema = z.strictObject({
  kind: z.literal('logql-lines'),
  ...logqlBase,
});

/** The LogQL builders' schemas, by kind. */
export const logqlBuilderSchemas = {
  'logql-series': logqlSeriesSchema,
  'logql-ratio': logqlRatioSchema,
  'logql-breakdown': logqlBreakdownSchema,
  'logql-stat': logqlStatSchema,
  'logql-lines': logqlLinesSchema,
} as const;
