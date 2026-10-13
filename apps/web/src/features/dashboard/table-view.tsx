import type { QueryOutcome, TableView as TableViewSpec, ToneAs } from '@quanthea/shared';
import { useMemo } from 'react';
import styles from './panels.module.css';
import tableStyles from './table.module.css';
import { type TableCell, type TableRow, type TableRows, tableRows } from './table-rows.ts';
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
 * A table.
 *
 * @param props - The view, the outcomes and the time zone.
 * @returns The table.
 */
export function TableView({ view, queries, timeZone }: TableViewProps) {
  const table = useMemo(() => tableRows(view, queries, timeZone), [view, queries, timeZone]);
  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            {table.columns.map((column) => (
              <th key={column.label} data-align={column.align}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <BodyRow key={row.key} row={row} columns={table.columns} />
          ))}
        </tbody>
      </table>
      {table.truncated && (
        <p className={styles.note}>Showing the first {table.rows.length} rows.</p>
      )}
    </div>
  );
}
