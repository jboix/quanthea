/**
 * What a viewer does to a table, over the rows already fetched: the column a click sorts by, a
 * text filter per column, and the page shown. It changes nothing in the spec, whose sort is the
 * first order, and is kept per viewer, in snapshots and report runs too.
 */
import { compareFrameValues } from '@quanthea/shared';
import { pageStart } from '../../ui/paging.ts';
import type { TableRow } from './table-rows.ts';

/** The rows a page shows when the view says nothing. */
export const defaultPageSize = 20;

/** The column a viewer sorts by, and which way. */
export interface ClickSort {
  /** The column's place. */
  readonly column: number;
  /** Which way. */
  readonly dir: 'asc' | 'desc';
}

/** What a viewer did to a table. */
export interface TableState {
  /** The column a click sorts by; the view's own order when left out. */
  readonly sort?: ClickSort | undefined;
  /** The text each column's cells must hold, by the column's place; empty for none. */
  readonly filters: readonly string[];
  /** Where the page chosen starts. */
  readonly offset: number;
}

/** A table nobody touched. */
export const untouched: TableState = { filters: [], offset: 0 };

/** The page a viewer sees. */
export interface TablePage {
  /** The rows of the page, in order. */
  readonly rows: readonly TableRow[];
  /** How many rows come before the page's first. */
  readonly offset: number;
  /** How many rows pass the filters, on every page. */
  readonly total: number;
}

/**
 * The next sort when a header is clicked: up, then down, then the view's own order.
 *
 * @param sort - The sort now.
 * @param column - The column clicked.
 * @returns The sort after the click.
 */
export function nextSort(sort: ClickSort | undefined, column: number): ClickSort | undefined {
  if (sort?.column !== column) return { column, dir: 'asc' };
  return sort.dir === 'asc' ? { column, dir: 'desc' } : undefined;
}

/**
 * Whether a row holds each column's filter text, in any case.
 *
 * @param row - The row.
 * @param filters - The filters, by column.
 * @returns True when every filter is empty or found in its cell's text.
 */
function passes(row: TableRow, filters: readonly string[]): boolean {
  return filters.every((filter, column) => {
    const wanted = filter.trim().toLowerCase();
    if (wanted === '') return true;
    return (row.cells[column]?.text ?? '').toLowerCase().includes(wanted);
  });
}

/**
 * Orders rows by a column's raw values, so numbers sort as numbers.
 *
 * @param rows - The rows.
 * @param sort - The sort, if a viewer chose one.
 * @returns The rows ordered; as given without a sort.
 */
function sortedBy(rows: readonly TableRow[], sort: ClickSort | undefined): readonly TableRow[] {
  if (!sort) return rows;
  const direction = sort.dir === 'asc' ? 1 : -1;
  const at = sort.column;
  return [...rows].sort(
    (a, b) => direction * compareFrameValues(a.cells[at]?.value, b.cells[at]?.value),
  );
}

/**
 * The page a viewer sees: the rows filtered, sorted, then cut to the page. A page chosen past the
 * end of rows that shrank shows the last page.
 *
 * @param rows - The table's rows, in the view's order.
 * @param state - What the viewer did.
 * @param size - How many rows a page shows.
 * @returns The page.
 */
export function tablePage(rows: readonly TableRow[], state: TableState, size: number): TablePage {
  const kept = sortedBy(
    rows.filter((row) => passes(row, state.filters)),
    state.sort,
  );
  const offset = pageStart(state.offset, size, kept.length);
  return { rows: kept.slice(offset, offset + size), offset, total: kept.length };
}

/**
 * A filter changed: the other filters stay, and the first page shows.
 *
 * @param state - What the viewer did.
 * @param column - The column's place.
 * @param text - Its new filter.
 * @returns The state after the change.
 */
export function withFilter(state: TableState, column: number, text: string): TableState {
  const filters = [...state.filters];
  filters[column] = text;
  return { ...state, filters: Array.from(filters, (each) => each ?? ''), offset: 0 };
}
