import {
  imageHostAllowed,
  type QueryOutcome,
  type TableView as TableViewSpec,
  type ToneAs,
  type ValueColor,
} from '@quanthea/shared';
import { useContext, useMemo, useState } from 'react';
import { ImageHostsContext } from './image-hosts.ts';
import { LinkTo } from './link-to.tsx';
import type { PanelLinks } from './links.ts';
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
import { ColumnWidths } from './table-widths.tsx';
import { toneStyle } from './tone.ts';

/** Props of {@link TableView}. */
interface TableViewProps {
  /** The table view. */
  readonly view: TableViewSpec;
  /** The outcome of each query of the panel. */
  readonly queries: readonly QueryOutcome[];
  /** The IANA time zone, or the browser's. */
  readonly timeZone: string | undefined;
  /** The dashboard's colour per value, for the cells of a column without mappings. */
  readonly colors?: readonly ValueColor[] | undefined;
  /** What the cells' links are built from; without it, a linked column shows text. */
  readonly links?: PanelLinks | undefined;
}

/**
 * What a cell shows: its text, in its tone when it has one, as a link when it leads somewhere.
 *
 * @param props - The cell and how its column draws a tone.
 * @param props.cell - The cell.
 * @param props.toneAs - Whether the tone colours the text or tints behind it.
 * @returns The text, wrapped when it has a tone or a link.
 */
function CellText({
  cell,
  toneAs,
}: {
  readonly cell: TableCell;
  readonly toneAs: ToneAs | undefined;
}) {
  if (!cell.href) return <CellValue cell={cell} toneAs={toneAs} />;
  return (
    <LinkTo to={cell.href} className={tableStyles.link}>
      <CellValue cell={cell} toneAs={toneAs} />
    </LinkTo>
  );
}

/**
 * A cell's image. It loads lazily and tells its host nothing of the page that shows it.
 *
 * @param props - The cell.
 * @param props.cell - The cell, its value an https address.
 * @returns The image.
 */
function CellImage({ cell }: { readonly cell: TableCell }) {
  return (
    <img
      className={tableStyles.image}
      src={String(cell.value)}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  );
}

/**
 * A cell's text, in its tone when it has one, or its image when its column shows images from an
 * allowed host.
 *
 * @param props - The cell and how its column draws a tone.
 * @param props.cell - The cell.
 * @param props.toneAs - Whether the tone colours the text or tints behind it.
 * @returns The text, wrapped when it has a tone.
 */
function CellValue({
  cell,
  toneAs,
}: {
  readonly cell: TableCell;
  readonly toneAs: ToneAs | undefined;
}) {
  const hosts = useContext(ImageHostsContext);
  if (cell.imageHost && hosts && imageHostAllowed(hosts, cell.imageHost))
    return <CellImage cell={cell} />;
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
 * One row of a table's body. In a table of fixed widths a cell cuts a long text and keeps it
 * whole in its title.
 *
 * @param props - The row, the columns and whether the widths are fixed.
 * @param props.row - The row.
 * @param props.columns - The columns of the table.
 * @param props.fixed - Whether the columns have fixed widths.
 * @returns The row.
 */
function BodyRow({
  row,
  columns,
  fixed,
}: {
  readonly row: TableRow;
  readonly columns: TableRows['columns'];
  readonly fixed: boolean;
}) {
  return (
    <tr>
      {row.cells.map((cell, index) => (
        <td
          key={columns[index]?.label ?? index}
          data-align={columns[index]?.align}
          title={fixed ? cell.text : undefined}
        >
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
 * @returns The table, scrolling on its own, and its pager under it.
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
  const fixed = table.columns.some((column) => column.width);
  return (
    <>
      <div className={tableStyles.tableScroll}>
        <table className={tableStyles.table} data-fixed={fixed || undefined}>
          <ColumnWidths columns={table.columns} />
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
              <BodyRow key={row.key} row={row} columns={table.columns} fixed={fixed} />
            ))}
          </tbody>
        </table>
      </div>
      <TablePager
        page={page}
        size={pageSize}
        onMove={(offset) => setState((now) => ({ ...now, offset }))}
      />
    </>
  );
}

/**
 * The first row of a table as labelled values, one column a line, each cell as the table would
 * show it.
 *
 * @param props - The table.
 * @param props.table - The table built from the results.
 * @returns The labelled values.
 */
function RecordList({ table }: { readonly table: TableRows }) {
  const cells = table.rows[0]?.cells ?? [];
  return (
    <dl className={tableStyles.record}>
      {table.columns.map((column, index) => {
        const cell = cells[index] ?? { value: null, text: '' };
        return (
          <div key={column.label} className={tableStyles.recordLine}>
            <dt>{column.label}</dt>
            <dd>
              <CellText cell={cell} toneAs={column.toneAs} />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * The first row of a table as one headline value, its first column, and the other cells on one
 * line below, each named by its column for a pointer and a screen reader.
 *
 * @param props - The table.
 * @param props.table - The table built from the results.
 * @returns The compact record.
 */
function CompactRecord({ table }: { readonly table: TableRows }) {
  const cells = table.rows[0]?.cells ?? [];
  const [headline, ...details] = table.columns.map((column, index) => ({
    column,
    cell: cells[index] ?? { value: null, text: '' },
  }));
  return (
    <div className={tableStyles.compact}>
      {headline && (
        <div className={tableStyles.compactValue}>
          <CellText cell={headline.cell} toneAs={headline.column.toneAs} />
        </div>
      )}
      <p className={tableStyles.compactDetails}>
        {details.map(({ column, cell }) => (
          <span key={column.label} title={column.label}>
            <span className={tableStyles.visuallyHidden}>{column.label}: </span>
            <CellText cell={cell} toneAs={column.toneAs} />
          </span>
        ))}
      </p>
    </div>
  );
}

/**
 * A table. A viewer sorts it by a click on a header, filters it per column and reads it a page at
 * a time; that state starts again when the columns change. A record shows its first row as
 * labelled values instead, and a compact one as a headline value over a line of the others.
 *
 * @param props - The view, the outcomes, the time zone, the dashboard's colours and the links.
 * @returns The table.
 */
export function TableView({ view, queries, timeZone, colors, links }: TableViewProps) {
  const table = useMemo(
    () => tableRows(view, queries, timeZone, colors, links),
    [view, queries, timeZone, colors, links],
  );
  const columnsKey = table.columns.map((column) => column.label).join('\u0000');
  if (view.record && view.compact) return <CompactRecord table={table} />;
  if (view.record) return <RecordList table={table} />;
  return (
    <div className={tableStyles.tableFrame}>
      <WorkedTable key={columnsKey} table={table} pageSize={view.pageSize ?? defaultPageSize} />
      {table.truncated && (
        <p className={styles.note}>Showing the first {table.rows.length} rows.</p>
      )}
    </div>
  );
}
