/**
 * Frames as row tables, the shape ECharts datasets take, and the transforms a spec may apply to
 * them before the chart draws them.
 */
import { compareFrameValues, type DatasetTransform, type Field, type Frame } from '@querent/shared';

/** A result as rows: one array per row, in field order. */
export interface Table {
  /** A name for the series drawn from it, from the series labels or the frame name. */
  readonly name: string;
  /** The fields, in column order. */
  readonly fields: readonly Field[];
  /** The rows. */
  readonly rows: readonly (readonly unknown[])[];
}

/**
 * Names a frame: its series labels (`checkout-svc`, or `checkout-svc · 502` for several), else its
 * name, else its first number field.
 *
 * @param frame - The frame.
 * @returns The name.
 */
function nameOf(frame: Frame): string {
  const labelled = frame.fields.find(
    (field) => field.labels && Object.keys(field.labels).length > 0,
  );
  if (labelled?.labels) return Object.values(labelled.labels).join(' · ');
  return frame.name ?? frame.fields.find((field) => field.type === 'number')?.name ?? frame.refId;
}

/**
 * Turns a columnar frame into a table.
 *
 * @param frame - The frame.
 * @returns The table.
 */
export function tableOf(frame: Frame): Table {
  const rows = Array.from({ length: frame.meta.rowCount }, (_row, index) =>
    frame.values.map((column) => column[index] ?? null),
  );
  return { name: nameOf(frame), fields: frame.fields, rows };
}

/**
 * The field a chart puts on its category axis: the first time field, else the first text field,
 * else the first field.
 *
 * @param table - The table.
 * @returns The field, if the table has any.
 */
export function categoryField(table: Table): Field | undefined {
  return (
    table.fields.find((field) => field.type === 'time') ??
    table.fields.find((field) => field.type === 'string') ??
    table.fields[0]
  );
}

/**
 * The column index of a field.
 *
 * @param table - The table.
 * @param name - The field name.
 * @returns The index, or -1.
 */
function indexOf(table: Table, name: string): number {
  return table.fields.findIndex((field) => field.name === name);
}

/**
 * Pivots a long table to a wide one: one column per value of `by`, holding the first number field,
 * one row per value of the category field.
 *
 * @param table - The long table, such as time, service, rate.
 * @param by - The field whose values become columns.
 * @returns The wide table, such as time, checkout-svc, payments-svc.
 */
function pivot(table: Table, by: string): Table {
  const byIndex = indexOf(table, by);
  const category = table.fields.find(
    (field, index) => index !== byIndex && field.type !== 'number',
  );
  const value = table.fields.find((field) => field.type === 'number');
  if (byIndex < 0 || !category || !value) return table;
  const [categoryIndex, valueIndex] = [indexOf(table, category.name), indexOf(table, value.name)];
  const columns = [...new Set(table.rows.map((row) => String(row[byIndex])))];
  const grouped = new Map<unknown, unknown[]>();
  for (const row of table.rows) {
    const key = row[categoryIndex];
    const wide = grouped.get(key) ?? [key, ...columns.map(() => null)];
    wide[columns.indexOf(String(row[byIndex])) + 1] = row[valueIndex];
    grouped.set(key, wide);
  }
  const fields = [category, ...columns.map((name) => ({ name, type: 'number' as const }))];
  return { name: table.name, fields, rows: [...grouped.values()] };
}

/**
 * Applies a transform.
 *
 * @param table - The table.
 * @param transform - The transform, if any.
 * @returns The transformed table.
 */
export function transformTable(table: Table, transform: DatasetTransform | undefined): Table {
  if (!transform) return table;
  if (transform.type === 'pivot') return pivot(table, transform.by);
  const index = indexOf(table, transform.field);
  if (index < 0) return table;
  if (transform.type === 'filter') {
    const kept = new Set(transform.in);
    return { ...table, rows: table.rows.filter((row) => kept.has(String(row[index]))) };
  }
  const direction = transform.dir === 'asc' ? 1 : -1;
  const rows = [...table.rows].sort((a, b) => direction * compareFrameValues(a[index], b[index]));
  return { ...table, rows };
}
