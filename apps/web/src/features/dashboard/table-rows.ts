/** Builds the rows of a table panel from its results: columns by field or label name, formatted. */

import {
  compareFrameValues,
  createFormatter,
  type Frame,
  type QueryOutcome,
  type TableView,
} from '@querent/shared';

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
 * Reads one cell: a field of the frame, or else a label of its value field, as range series carry
 * their labels there.
 *
 * @param frame - The frame.
 * @param name - The column's field name.
 * @param row - The row index.
 * @returns The value, or `null`.
 */
function cellOf(frame: Frame, name: string, row: number): unknown {
  const index = frame.fields.findIndex((field) => field.name === name);
  if (index >= 0) return frame.values[index]?.[row] ?? null;
  return frame.fields.find((field) => field.labels?.[name] !== undefined)?.labels?.[name] ?? null;
}

/**
 * The raw rows of the view's result, one per row of each frame.
 *
 * @param view - The table view.
 * @param frames - The frames of its ref.
 * @returns Rows of raw values, in column order.
 */
function rawRows(view: TableView, frames: readonly Frame[]): unknown[][] {
  return frames.flatMap((frame) =>
    Array.from({ length: frame.meta.rowCount }, (_row, index) =>
      view.columns.map((column) => cellOf(frame, column.field, index)),
    ),
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
