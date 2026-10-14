import type { QueryOutcome, TableView as TableViewSpec, ToneAs } from '@quanthea/shared';
import { useMemo, useState } from 'react';
import styles from './panels.module.css';
import tableStyles from './table.module.css';
import { TableFilters, TableHead, TablePager } from './table-head.tsx';
import { type TableCell, type TableRow, type TableRows, tableRows } from './table-rows.ts';
import {
  defaultPageSize,
  nextSort,
  type TableState,
  tablePage,
  untouched,
  withFilter,
} from './table-state.ts';
import { toneStyle } from './tone.ts';

/** Props of {@link TableView}. */
interface TableViewProps {
  /** The table view. */
  readonly view: TableViewSpec;
  /** The outcome of each query of the panel. */
  readonly queries: readonly QueryOutcome[];
  /** The IANA time zone, or the browser's. */
  readonly timeZone: string | undefined;
}

/**
 * What a cell shows: its text, in its tone when it has one.
 *
 * @param props - The cell and how its column draws a tone.
 * @param props.cell - The cell.
 * @param props.toneAs - Whether the tone colours the text or tints behind it.
 * @returns The text, wrapped when it has a tone.
 */
function CellText({
  cell,
  toneAs,
}: {
  readonly cell: TableCell;
  readonly toneAs: ToneAs | undefined;
}) {
  if (!cell.tone) return cell.text;
  return (
    <span
      className={tableStyles.toned}
      data-tone-as={toneAs ?? 'text'}
      style={toneStyle(cell.tone)}
    >
      {cell.text}
    </span>
  );
}

/**
 * One row of a table's body.
 *
 * @param props - The row and the columns.
 * @param props.row - The row.
 * @param props.columns - The columns of the table.
 * @returns The row.
 */
function BodyRow({
  row,
  columns,
}: {
  readonly row: TableRow;
  readonly columns: TableRows['columns'];
}) {
  return (
    <tr>
      {row.cells.map((cell, index) => (
        <td key={columns[index]?.label ?? index} data-align={columns[index]?.align}>
          <CellText cell={cell} toneAs={columns[index]?.toneAs} />
        </td>
      ))}
    </tr>
  );
}

/**
 * A table's rows as a viewer works them: sorted by a click, filtered per column, a page at a time.
 *
 * @param props - The table built from the results, and the rows a page shows.
 * @param props.table - The table.
 * @param props.pageSize - How many rows a page shows.
 * @returns The table and its pager.
 */
function WorkedTable({
  table,
  pageSize,
}: {
  readonly table: TableRows;
  readonly pageSize: number;
}) {
  const [state, setState] = useState<TableState>(untouched);
  const page = tablePage(table.rows, state, pageSize);
  const filtering = table.rows.length > pageSize || state.filters.some((each) => each !== '');
  return (
    <>
      <table className={styles.table}>
        <thead>
          <TableHead
            columns={table.columns}
            sort={state.sort}
            onSort={(column) =>
              setState((now) => ({ ...now, sort: nextSort(now.sort, column), offset: 0 }))
            }
          />
          {filtering && (
            <TableFilters
              columns={table.columns}
              filters={state.filters}
              onFilter={(column, text) => setState((now) => withFilter(now, column, text))}
            />
          )}
        </thead>
        <tbody>
          {page.rows.map((row) => (
            <BodyRow key={row.key} row={row} columns={table.columns} />
          ))}
        </tbody>
      </table>
      <TablePager
        page={page}
        size={pageSize}
        onMove={(offset) => setState((now) => ({ ...now, offset }))}
      />
    </>
  );
}

/**
 * A table. A viewer sorts it by a click on a header, filters it per column and reads it a page at
 * a time; that state starts again when the columns change.
 *
 * @param props - The view, the outcomes and the time zone.
 * @returns The table.
 */
export function TableView({ view, queries, timeZone }: TableViewProps) {
  const table = useMemo(() => tableRows(view, queries, timeZone), [view, queries, timeZone]);
  const columnsKey = table.columns.map((column) => column.label).join('\u0000');
  return (
    <div className={styles.tableScroll}>
      <WorkedTable key={columnsKey} table={table} pageSize={view.pageSize ?? defaultPageSize} />
      {table.truncated && (
        <p className={styles.note}>Showing the first {table.rows.length} rows.</p>
      )}
    </div>
  );
}
