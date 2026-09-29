/**
 * The data contract between connectors and charts: every query result becomes a table of typed
 * columns and rows, which maps directly onto an ECharts `dataset`. Charts declare the shape of
 * table they need; any connector can produce any shape.
 */
import { z } from 'zod';

/** A column type. Times are Unix epoch milliseconds. */
export const dimensionTypes = ['time', 'number', 'string', 'boolean'] as const;

/** A column type. */
export type DimensionType = (typeof dimensionTypes)[number];

/** Validates a column: its name, type and unit. */
export const dimensionSchema = z.strictObject({
  name: z.string().min(1).max(200),
  type: z.enum(dimensionTypes),
  unit: z.string().max(40).optional(),
});

/** A column. */
export type Dimension = z.infer<typeof dimensionSchema>;

/** One value of a row; `null` is a missing value. */
export type Cell = string | number | boolean | null;

/** Validates one value of a row. */
const cellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/**
 * Whether a value fits a column type.
 *
 * @param type - The column type.
 * @param value - The value.
 * @returns `true` for `null` and for values of the type; numbers and times must be finite.
 */
export function fitsDimension(type: DimensionType, value: Cell): boolean {
  if (value === null) return true;
  if (type === 'time' || type === 'number')
    return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

/** Validates a dataset: every row as long as the columns, every value of its column's type. */
export const datasetSchema = z
  .strictObject({
    dimensions: z.array(dimensionSchema).min(1).max(100),
    source: z.array(z.array(cellSchema)),
  })
  .superRefine((dataset, context) => {
    for (const [index, row] of dataset.source.entries()) {
      const wrong = dataset.dimensions.findIndex(
        (column, at) => !fitsDimension(column.type, row[at] ?? null),
      );
      if (row.length !== dataset.dimensions.length || wrong >= 0) {
        context.addIssue({
          code: 'custom',
          path: ['source', index],
          message: 'The row does not fit the columns.',
        });
        return;
      }
    }
  });

/** A table of typed columns and rows: what every query result becomes. */
export interface Dataset {
  /** The columns, in row order. */
  readonly dimensions: readonly Dimension[];
  /** The rows, each as long as the columns. */
  readonly source: readonly (readonly Cell[])[];
}

/** The shapes of table a chart can ask for. */
export const shapeKinds = [
  'long',
  'wide',
  'single',
  'values',
  'matrix',
  'hierarchical',
  'graph',
  'geo',
  'ohlc',
  'rows',
] as const;

/** A shape of table. */
export type ShapeKind = (typeof shapeKinds)[number];

/** What each shape holds, in words for the agent and the gallery. */
export const shapeGuides: Readonly<Record<ShapeKind, string>> = {
  long: 'One row per x and series: an x (time or category), a series name, and a value. Most query results over time are long.',
  wide: 'One row per x: an x (time or category), then one number column per series.',
  single: 'One row: a value, and optionally a previous value or a target to compare with.',
  values: 'Raw numbers, one per row, and optionally a group: the chart bins or summarises them.',
  matrix: 'One row per cell: an x, a y and a value, for heatmaps.',
  hierarchical:
    'One row per leaf: a column per level from the root down, and a value. Or id, parent, name and value.',
  graph: 'One row per link: a source, a target and a value. Nodes come from the links.',
  geo: 'One row per place: a region name and a value, or a latitude, a longitude and a value.',
  ohlc: 'One row per period: a time, then open, close, low and high, and optionally a volume.',
  rows: 'Any columns: a table as it comes.',
};
