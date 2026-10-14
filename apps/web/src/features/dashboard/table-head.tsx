/** The controls of a table: headers that sort on a click, a filter per column, and its pages. */
import { Pager } from '../../ui/pager.tsx';
import tableStyles from './table.module.css';
import type { TableRows } from './table-rows.ts';
import type { ClickSort, TablePage } from './table-state.ts';

/** Props of {@link TableHead}. */
interface TableHeadProps {
  /** The columns. */
  readonly columns: TableRows['columns'];
  /** The column a click sorts by, if any. */
  readonly sort: ClickSort | undefined;
  /** Sorts by the column at a place. */
  readonly onSort: (column: number) => void;
}

/**
 * How a column is sorted, for assistive technology.
 *
 * @param sort - The sort.
 * @param column - The column's place.
 * @returns The `aria-sort` value.
 */
function ariaSort(sort: ClickSort | undefined, column: number) {
  if (sort?.column !== column) return 'none';
  return sort.dir === 'asc' ? 'ascending' : 'descending';
}

/**
 * The headers. Each is a button: a click sorts up, a second down, a third back to the view's order.
 *
 * @param props - The columns, the sort and what a click does.
 * @returns The row of headers.
 */
export function TableHead({ columns, sort, onSort }: TableHeadProps) {
  return (
    <tr>
      {columns.map((column, index) => (
        <th key={column.label} data-align={column.align} aria-sort={ariaSort(sort, index)}>
          <button type="button" className={tableStyles.sort} onClick={() => onSort(index)}>
            {column.label}
            <span className={tableStyles.arrow} aria-hidden="true">
              {sort?.column === index ? (sort.dir === 'asc' ? '↑' : '↓') : ''}
            </span>
          </button>
        </th>
      ))}
    </tr>
  );
}

/** Props of {@link TableFilters}. */
interface TableFiltersProps {
  /** The columns. */
  readonly columns: TableRows['columns'];
  /** The filter of each column, by place. */
  readonly filters: readonly string[];
  /** Sets the filter of the column at a place. */
  readonly onFilter: (column: number, text: string) => void;
}

/**
 * A text filter under each header. A row passes when each cell's text holds its filter, in any case.
 *
 * @param props - The columns, their filters and what a change does.
 * @returns The row of filters.
 */
export function TableFilters({ columns, filters, onFilter }: TableFiltersProps) {
  return (
    <tr className={tableStyles.filters}>
      {columns.map((column, index) => (
        <th key={column.label} data-align={column.align}>
          <input
            type="search"
            className={tableStyles.filter}
            aria-label={`Filter ${column.label}`}
            placeholder="Filter"
            value={filters[index] ?? ''}
            onChange={(event) => onFilter(index, event.target.value)}
          />
        </th>
      ))}
    </tr>
  );
}

/** What the controls of a table's pages say. */
const pageWords = { newer: 'Previous', older: 'Next' } as const;

/** Props of {@link TablePager}. */
interface TablePagerProps {
  /** The page shown. */
  readonly page: TablePage;
  /** How many rows a page shows. */
  readonly size: number;
  /** Shows the page that starts at an offset. */
  readonly onMove: (offset: number) => void;
}

/**
 * The pages of a table: which rows show, of how many, and Previous and Next.
 *
 * @param props - The page, the page size and what a move does.
 * @returns The pager; nothing when every row fits on one page.
 */
export function TablePager({ page, size, onMove }: TablePagerProps) {
  if (page.total <= size) return null;
  const { offset, total } = page;
  return (
    <Pager
      label="Table pages"
      offset={offset}
      shown={page.rows.length}
      total={total}
      words={pageWords}
      onNewer={offset > 0 ? () => onMove(offset - size) : undefined}
      onOlder={offset + size < total ? () => onMove(offset + size) : undefined}
    />
  );
}
