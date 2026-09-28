/** How a panel shows its query results: a stat, a table, or an ECharts chart. */
import { z } from 'zod';
import { formatterSchema } from '../formatters/schema.ts';
import { refIdSchema, slugSchema } from './names.ts';

/** Validates a field name in a result frame. */
const fieldNameSchema = z.string().min(1).max(200);

/** Validates how a stat reduces a column to one number. */
const reduceSchema = z.enum(['last', 'first', 'max', 'min', 'mean', 'sum', 'count']);

/** How a stat reduces a column to one number. */
export type Reduce = z.infer<typeof reduceSchema>;

/** Validates a stat: one big number, with an optional comparison. */
const statViewSchema = z.strictObject({
  kind: z.literal('stat'),
  ref: refIdSchema,
  field: fieldNameSchema.optional(),
  reduce: reduceSchema,
  format: formatterSchema,
  subtitle: z.string().max(200).optional(),
  compare: z
    .strictObject({ ref: refIdSchema, reduce: reduceSchema, label: z.string().min(1).max(60) })
    .optional(),
});

/** Validates a table column. */
const columnSchema = z.strictObject({
  field: fieldNameSchema,
  label: z.string().max(100).optional(),
  format: formatterSchema.optional(),
  align: z.enum(['left', 'right']).optional(),
});

/** Validates a table. */
const tableViewSchema = z.strictObject({
  kind: z.literal('table'),
  ref: refIdSchema,
  columns: z.array(columnSchema).min(1).max(50),
  sort: z.strictObject({ field: fieldNameSchema, dir: z.enum(['asc', 'desc']) }).optional(),
  limit: z.int().min(1).max(500).optional(),
});

/** Validates a transform applied to a dataset before the chart gets it. */
const datasetTransformSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('pivot'), by: fieldNameSchema }),
  z.strictObject({
    type: z.literal('filter'),
    field: fieldNameSchema,
    in: z.array(z.string().max(200)).max(200),
  }),
  z.strictObject({ type: z.literal('sort'), field: fieldNameSchema, dir: z.enum(['asc', 'desc']) }),
]);

/** A transform applied to a dataset. */
export type DatasetTransform = z.infer<typeof datasetTransformSchema>;

/**
 * Validates a chart: a JSON subset of an ECharts option, and the results it draws. The validator
 * checks the option against an allowlist; the adapter owns datasets, theme and tooltips.
 */
const chartViewSchema = z.strictObject({
  kind: z.literal('chart'),
  option: z.record(z.string(), z.json()),
  datasets: z
    .array(z.strictObject({ ref: refIdSchema, transform: datasetTransformSchema.optional() }))
    .min(1)
    .max(4),
  markers: z
    .array(z.strictObject({ annotation: slugSchema }))
    .max(4)
    .optional(),
});

/** Validates a panel view. */
export const viewSchema = z.discriminatedUnion('kind', [
  statViewSchema,
  tableViewSchema,
  chartViewSchema,
]);

/** A panel view. */
export type View = z.infer<typeof viewSchema>;

/** A stat view. */
export type StatView = z.infer<typeof statViewSchema>;

/** A table view. */
export type TableView = z.infer<typeof tableViewSchema>;

/** A chart view. */
export type ChartView = z.infer<typeof chartViewSchema>;
