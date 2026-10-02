import { diffLines } from '@quanthea/shared';
import styles from './cards.module.css';
import changeStyles from './change-list.module.css';
import type { ChangeRow } from './plan-changes.ts';

/** The words of each tag, as the plan card shows them. */
const tagWords: Readonly<Record<ChangeRow['tag'], string>> = {
  changed: 'CHANGED',
  new: 'NEW',
  removed: 'REMOVED',
  same: 'SAME',
};

/**
 * What a row says: the panel and its change, the new panel and its kind, or how many stay.
 *
 * @param row - The row.
 * @returns The text.
 */
function rowText(row: ChangeRow): string {
  if (row.tag === 'same')
    return `${row.count} ${row.count === 1 ? 'panel' : 'panels'} kept as they are`;
  if (row.tag === 'new') return `${row.title} (${row.kind})`;
  if (row.tag === 'changed' && row.note) return `${row.title}: ${row.note}`;
  return row.title;
}

/**
 * The query of a row, when the plan carries it: a diff for a changed panel, the query for a new one.
 *
 * @param props - The row.
 * @param props.row - The row.
 * @returns The lines, or nothing.
 */
function RowQuery({ row }: { readonly row: ChangeRow }) {
  if (row.tag === 'new' && row.query)
    return <pre className={changeStyles.changeQuery}>{row.query}</pre>;
  if (row.tag !== 'changed' || row.after === undefined) return null;
  const lines = diffLines(row.before ?? '', row.after)
    .filter((line) => line.kind !== ' ')
    .slice(0, 12)
    .map((line, position) => ({ ...line, key: String(position) }));
  return (
    <ul className={styles.diffLines}>
      {lines.map((line) => (
        <li key={line.key} data-kind={line.kind}>
          {line.kind} {line.text}
        </li>
      ))}
    </ul>
  );
}

/**
 * Rows with keys for the list: their tag and position, since rows never move.
 *
 * @param rows - The rows.
 * @returns The rows with keys.
 */
function keyed(rows: readonly ChangeRow[]) {
  return rows.map((row, position) => ({ row, key: `${row.tag}:${position}` }));
}

/**
 * A plan as changes to the draft: each row tagged CHANGED, NEW, REMOVED or SAME.
 *
 * @param props - The rows.
 * @param props.rows - The plan's changes.
 * @returns The list.
 */
export function ChangeList({ rows }: { readonly rows: readonly ChangeRow[] }) {
  return (
    <ul className={changeStyles.changes}>
      {keyed(rows).map(({ row, key }) => (
        <li key={key} data-tag={row.tag}>
          <span className={changeStyles.changeTag}>{tagWords[row.tag]}</span>
          <div className={changeStyles.changeBody}>
            <span>{rowText(row)}</span>
            <RowQuery row={row} />
          </div>
        </li>
      ))}
    </ul>
  );
}
