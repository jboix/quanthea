/**
 * Builds the rows of a table panel from its results, read as a dataset: columns by name, labels of
 * range series included, formatted.
 */

import {
  compareFrameValues,
  createFormatter,
  datasetOfFrames,
  type Frame,
  type QueryOutcome,
  type TableView,
} from '@quanthea/shared';
import { columnIn } from './reduce.ts';

/** A table ready to render. */
export interface TableRows {
  /** The column headers and alignments. */
  readonly columns: readonly { readonly label: string; readonly align: 'left' | 'right' }[];
  /** The rows: a key, stable for the result, and the formatted cells. */
  readonly rows: readonly { readonly key: string; readonly cells: readonly string[] }[];
  /** Whether rows were cut at the limit. */
  readonly truncated: boolean;
}

/** The most rows a table shows. */
const maxRows = 500;

/**
 * The raw rows of the view's result, in the view's column order.
 *
 * @param view - The table view.
 * @param frames - The frames of its ref.
 * @returns Rows of raw values; a column the result has not reads `null`.
 */
function rawRows(view: TableView, frames: readonly Frame[]): unknown[][] {
  const dataset = datasetOfFrames(frames);
  const indexes = view.columns.map((column) => columnIn(dataset, column.field));
  return dataset.source.map((row) =>
    indexes.map((index) => (index < 0 ? null : (row[index] ?? null))),
  );
}

/**
 * Builds the rows of a table panel.
 *
 * @param view - The table view.
 * @param queries - The outcomes of the panel's queries.
 * @param timeZone - The zone for date formatters.
 * @returns The columns and the formatted rows.
 */
export function tableRows(
  view: TableView,
  queries: readonly QueryOutcome[],
  timeZone?: string,
): TableRows {
  const frames = queries.find((query) => query.refId === view.ref)?.frames ?? [];
  let rows = rawRows(view, frames);
  const sortIndex = view.columns.findIndex((column) => column.field === view.sort?.field);
  if (view.sort && sortIndex >= 0) {
    const direction = view.sort.dir === 'asc' ? 1 : -1;
    rows = rows.sort((a, b) => direction * compareFrameValues(a[sortIndex], b[sortIndex]));
  }
  const limit = Math.min(view.limit ?? maxRows, maxRows);
  const formats = view.columns.map((column) =>
    createFormatter(column.format ?? '{value}', { timeZone }),
  );
  return {
    columns: view.columns.map((column) => ({
      label: column.label ?? column.field,
      align: column.align ?? 'left',
    })),
    rows: rows.slice(0, limit).map((row, position) => ({
      key: String(position),
      cells: row.map((value, index) => formats[index]?.(value) ?? ''),
    })),
    truncated: rows.length > limit,
  };
}
