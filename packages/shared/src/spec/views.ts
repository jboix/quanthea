/** How a panel shows its query results: a stat, a table, or an ECharts chart. */
import { z } from 'zod';
import { prepareKinds } from '../chart-recipes/prepare.ts';
import { formatterSchema } from '../formatters/schema.ts';
import { type Link, linkSchema } from './links.ts';
import { refIdSchema, slugSchema } from './names.ts';
import { mappingsSchema, toneAsSchema } from './tones.ts';

/** Validates a field name in a result frame. */
const fieldNameSchema = z.string().min(1).max(200);

/** Validates how a stat reduces a column to one number. */
const reduceSchema = z.enum(['last', 'first', 'max', 'min', 'mean', 'sum', 'count']);

/** How a stat reduces a column to one number. */
export type Reduce = z.infer<typeof reduceSchema>;

/** The most tiles a stat over a breakdown shows. */
export const maxStatTiles = 24;

/** Validates a stat: one big number, with an optional comparison. */
const statViewSchema = z.strictObject({
  kind: z.literal('stat'),
  ref: refIdSchema,
  field: fieldNameSchema.optional(),
  reduce: reduceSchema,
  format: formatterSchema,
  /**
   * What the stat reads as and the tone it takes: the first mapping that matches its value. With
   * `first` or `last` the value is the column's own, so a text, a boolean or no value can match.
   */
  mappings: mappingsSchema.optional(),
  /** How the stat shows its tone: as the colour of its text when left out, or as a tint behind it. */
  toneAs: toneAsSchema.optional(),
  subtitle: z.string().max(200).optional(),
  compare: z
    .strictObject({ ref: refIdSchema, reduce: reduceSchema, label: z.string().min(1).max(60) })
    .optional(),
  /** A pinned dashboard or a page the stat opens. */
  link: linkSchema.optional(),
  /**
   * A column of names: the stat shows a tile for each row, at most {@link maxStatTiles}, labelled
   * by it, with that row's value.
   */
  each: fieldNameSchema.optional(),
});

/** Validates a table column. */
const columnSchema = z.strictObject({
  field: fieldNameSchema,
  label: z.string().max(100).optional(),
  format: formatterSchema.optional(),
  align: z.enum(['left', 'right']).optional(),
  /**
   * What a value of the column reads as and the tone it takes: the first mapping that matches the
   * raw value. A mapped text replaces the format.
   */
  mappings: mappingsSchema.optional(),
  /** How a cell shows its tone: as the colour of its text when left out, or as a tint behind it. */
  toneAs: toneAsSchema.optional(),
  /** How wide the column is beside the others; it shares what is left when left out. */
  width: z.enum(['narrow', 'medium', 'wide']).optional(),
  /** A pinned dashboard or a page each cell opens. */
  link: linkSchema.optional(),
  /** Shows each cell's https address as an image, from a host an admin marked for images. */
  display: z.literal('image').optional(),
});

/** Validates a table. */
const tableViewSchema = z.strictObject({
  kind: z.literal('table'),
  ref: refIdSchema,
  columns: z.array(columnSchema).min(1).max(50),
  /**
   * How every column of the result the table does not list is shown, after the listed ones: the
   * columns a pivot names by data, which a version cannot list. Left out, the table shows the
   * listed columns only.
   */
  rest: columnSchema.omit({ field: true, label: true }).optional(),
  /** The first order of the rows; a viewer may sort by another column with a click. */
  sort: z.strictObject({ field: fieldNameSchema, dir: z.enum(['asc', 'desc']) }).optional(),
  limit: z.int().min(1).max(500).optional(),
  /** How many rows a page shows: 20 when left out. */
  pageSize: z.int().min(5).max(100).optional(),
  /** Shows the first row as labelled values, one column a line: the fields of one document. */
  record: z.literal(true).optional(),
});

/** Validates a transform applied to a dataset before the chart gets it. */
const datasetTransformSchema = z.discriminatedUnion('type', [
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
 * What the time axis of a chart covers: the time range its panel ran over, or only the stretch
 * its data has.
 */
export const timeAxisModes = ['period', 'data'] as const;

/** What the time axis of a chart covers. */
export type TimeAxisMode = (typeof timeAxisModes)[number];

/**
 * Validates a chart: a JSON subset of an ECharts option, how its data is prepared, and the
 * results it draws. The validator checks the option against an allowlist; the adapter owns
 * datasets, theme and tooltips.
 */
const chartViewSchema = z.strictObject({
  kind: z.literal('chart'),
  /** The recipe and variants the chart came from, for people; drawing never reads it. */
  recipe: z
    .strictObject({ id: z.string().max(60), variants: z.array(z.string().max(40)).max(6) })
    .optional(),
  /** How the adapter prepares the data for the option. */
  prepare: z.enum(prepareKinds).default('cartesian'),
  /** The columns of each role the option's `@role` tokens name; missing roles are inferred. */
  roles: z
    .record(z.string().max(20), z.union([fieldNameSchema, z.array(fieldNameSchema).max(20)]))
    .default({}),
  /** How many categories the chart keeps, for pies, funnels and ranked bars. */
  limit: z.int().min(1).max(500).optional(),
  /**
   * What a time axis covers: `period`, the whole time range the panel ran over, when left out;
   * `data`, only the stretch that has data, for a person who asks for a chart cut to its data.
   */
  timeAxis: z.enum(timeAxisModes).optional(),
  option: z.record(z.string(), z.json()),
  /**
   * The steps of a gauge: ranges in the value's own unit, each with a tone, drawn as the colours
   * of the dial. The first range that holds a value wins. No other chart takes them.
   */
  mappings: mappingsSchema.optional(),
  /** The value the legend shows after each series name, written as the value axis writes it. */
  legendValues: z.enum(['total', 'mean', 'last', 'max']).optional(),
  datasets: z
    .array(z.strictObject({ ref: refIdSchema, transform: datasetTransformSchema.optional() }))
    .min(1)
    .max(4),
  markers: z
    .array(z.strictObject({ annotation: slugSchema }))
    .max(4)
    .optional(),
});

/** The most log lines a log view shows. */
export const maxLogLines = 500;

/**
 * Validates a log: a line for each row, with its time, its message from one column or several,
 * and a tone by its level. A line opens to show every column of its row.
 */
const logViewSchema = z.strictObject({
  kind: z.literal('log'),
  ref: refIdSchema,
  time: fieldNameSchema,
  message: z.array(fieldNameSchema).min(1).max(5),
  /** The column of levels, such as `error` or `warn`, which give each line its tone. */
  level: fieldNameSchema.optional(),
  limit: z.int().min(1).max(maxLogLines).optional(),
});

/** Validates a panel view. */
export const viewSchema = z.discriminatedUnion('kind', [
  statViewSchema,
  tableViewSchema,
  logViewSchema,
  chartViewSchema,
]);

/** A panel view. */
export type View = z.infer<typeof viewSchema>;

/** A stat view. */
export type StatView = z.infer<typeof statViewSchema>;

/** A table view. */
export type TableView = z.infer<typeof tableViewSchema>;

/** A log view. */
export type LogView = z.infer<typeof logViewSchema>;

/** A chart view. */
export type ChartView = z.infer<typeof chartViewSchema>;

/**
 * The links of a view: a stat's, or those of a table's columns. Charts have none.
 *
 * @param view - The view.
 * @returns The links, in order.
 */
export function viewLinks(view: View): Link[] {
  if (view.kind === 'stat') return view.link ? [view.link] : [];
  if (view.kind !== 'table') return [];
  return view.columns.flatMap((column) => (column.link ? [column.link] : []));
}
