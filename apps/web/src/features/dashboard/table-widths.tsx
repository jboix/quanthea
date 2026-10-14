/** The widths of a table's columns: narrow, medium or wide, shared out of the table's width. */
import type { ColumnWidth, TableColumn } from './table-rows.ts';

/** The share of each width, against the others. A column with none takes a medium share. */
const shares: Readonly<Record<ColumnWidth, number>> = { narrow: 1, medium: 2, wide: 4 };

/**
 * The width of each column, as a percentage of the table.
 *
 * @param columns - The columns.
 * @returns One percentage per column; none when no column sets a width.
 */
export function columnPercents(columns: readonly TableColumn[]): number[] {
  if (!columns.some((column) => column.width)) return [];
  const weights = columns.map((column) => shares[column.width ?? 'medium']);
  const total = weights.reduce((sum, each) => sum + each, 0);
  return weights.map((weight) => Math.round((weight / total) * 1000) / 10);
}

/**
 * The column group of a table whose columns set widths, which the table lays out as fixed.
 *
 * @param props - The columns.
 * @param props.columns - The columns.
 * @returns The group; nothing when no column sets a width.
 */
export function ColumnWidths({ columns }: { readonly columns: readonly TableColumn[] }) {
  const percents = columnPercents(columns);
  if (percents.length === 0) return null;
  return (
    <colgroup>
      {columns.map((column, index) => (
        <col
          key={column.label}
          data-width={column.width ?? 'medium'}
          style={{ width: `${percents[index]}%` }}
        />
      ))}
    </colgroup>
  );
}
