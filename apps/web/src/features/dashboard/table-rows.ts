/**
 * Builds the rows of a table panel from its results, read as a dataset: columns by name, labels of
 * range series included, each cell with its raw value and its text.
 */

import {
  compareFrameValues,
  createFormatter,
  datasetOfFrames,
  type Frame,
  type QueryOutcome,
  statColumnIndex,
  type TableView,
} from '@quanthea/shared';

/** One cell of a table. */
export interface TableCell {
  /** The value as the result holds it; `null` where the result has no such column or value. */
  readonly value: unknown;
  /** The value written with the column's format. */
  readonly text: string;
}

/** One row of a table. */
export interface TableRow {
  /** The place of the row in the result, which stays the same however the rows are ordered. */
  readonly key: string;
  /** The cells, in the order of the columns. */
  readonly cells: readonly TableCell[];
}

/** A table ready to render. */
export interface TableRows {
  /** The column headers and alignments. */
  readonly columns: readonly { readonly label: string; readonly align: 'left' | 'right' }[];
  /** The rows, in the order shown. */
  readonly rows: readonly TableRow[];
  /** Whether rows were cut at the limit. */
  readonly truncated: boolean;
}

/** A row of the result before it is formatted. */
interface SourceRow {
  /** The place of the row in the result. */
  readonly position: number;
  /** The raw values, in the order of the view's columns. */
  readonly values: readonly unknown[];
}

/** The most rows a table shows. */
const maxRows = 500;

/**
 * The raw rows of the view's result, in the view's column order.
 *
 * @param view - The table view.
 * @param frames - The frames of its ref.
 * @returns Rows of raw values with their place; a column the result has not reads `null`.
 */
function rawRows(view: TableView, frames: readonly Frame[]): SourceRow[] {
  const dataset = datasetOfFrames(frames);
  const indexes = view.columns.map((column) => statColumnIndex(dataset, column.field));
  return dataset.source.map((row, position) => ({
    position,
    values: indexes.map((index) => (index < 0 ? null : (row[index] ?? null))),
  }));
}

/**
 * Orders rows by the view's sort column.
 *
 * @param view - The table view.
 * @param rows - The rows of the result.
 * @returns The rows ordered, or as given when the view has no sort or sorts by a column it lacks.
 */
function sortedRows(view: TableView, rows: readonly SourceRow[]): readonly SourceRow[] {
  const sortIndex = view.columns.findIndex((column) => column.field === view.sort?.field);
  if (!view.sort || sortIndex < 0) return rows;
  const direction = view.sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort(
    (a, b) => direction * compareFrameValues(a.values[sortIndex], b.values[sortIndex]),
  );
}

/**
 * Builds the rows of a table panel.
 *
 * @param view - The table view.
 * @param queries - The outcomes of the panel's queries.
 * @param timeZone - The zone for date formatters.
 * @returns The columns, and the rows with each cell's raw value and text.
 */
export function tableRows(
  view: TableView,
  queries: readonly QueryOutcome[],
  timeZone?: string,
): TableRows {
  const frames = queries.find((query) => query.refId === view.ref)?.frames ?? [];
  const rows = sortedRows(view, rawRows(view, frames));
  const limit = Math.min(view.limit ?? maxRows, maxRows);
  const formats = view.columns.map((column) =>
    createFormatter(column.format ?? '{value}', { timeZone }),
  );
  return {
    columns: view.columns.map((column) => ({
      label: column.label ?? column.field,
      align: column.align ?? 'left',
    })),
    rows: rows.slice(0, limit).map((row) => ({
      key: String(row.position),
      cells: row.values.map((value, index) => ({ value, text: formats[index]?.(value) ?? '' })),
    })),
    truncated: rows.length > limit,
  };
}
