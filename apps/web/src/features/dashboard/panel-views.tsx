import {
  createFormatter,
  type MarkerOutcome,
  type Panel,
  type QueryOutcome,
  type StatView as StatViewSpec,
  type TableView as TableViewSpec,
} from '@quanthea/shared';
import { lazy, Suspense, useMemo } from 'react';
import { chartInputOf } from '../../charts/input.ts';
import { shownMarkers } from './marker-sets.ts';
import styles from './panels.module.css';
import { reduceResult } from './reduce.ts';
import { tableRows } from './table-rows.ts';

/** The chart component, loaded with ECharts the first time a dashboard draws a chart. */
const Chart = lazy(async () => ({ default: (await import('../../charts/index.ts')).Chart }));

/** What every view receives. */
interface ViewProps {
  /** The outcome of each query of the panel. */
  readonly queries: readonly QueryOutcome[];
  /** The IANA time zone, or the browser's. */
  readonly timeZone: string | undefined;
}

/**
 * The line under a stat: the comparison, then the subtitle, where `{{A.max}}` shows a reduced
 * result with the stat's format.
 *
 * @param view - The stat view.
 * @param queries - The query outcomes.
 * @param format - Formats a number with the stat's format.
 * @returns The line, or an empty string.
 */
function statSubtitle(
  view: StatViewSpec,
  queries: readonly QueryOutcome[],
  format: (value: unknown) => string,
): string {
  const compare = view.compare
    ? `${view.compare.label} ${format(reduceResult(queries, view.compare.ref, view.compare.reduce)) || '–'}`
    : '';
  const subtitle = (view.subtitle ?? '').replace(
    /\{\{(\w+)\.(\w+)\}\}/g,
    (_token, ref: string, reduce: string) =>
      format(reduceResult(queries, ref, reduce as StatViewSpec['reduce'])),
  );
  return [compare, subtitle].filter(Boolean).join(' · ');
}

/**
 * A stat: one number, and a line under it.
 *
 * @param props - The view, the outcomes and the time zone.
 * @param props.view - The stat view.
 * @returns The stat.
 */
function StatView({ view, queries, timeZone }: ViewProps & { readonly view: StatViewSpec }) {
  const format = createFormatter(view.format, { timeZone });
  const value = format(reduceResult(queries, view.ref, view.reduce, view.field));
  const subtitle = statSubtitle(view, queries, format);
  return (
    <div className={styles.stat}>
      <span className={styles.statValue}>{value || '–'}</span>
      {subtitle !== '' && <span className={styles.statSubtitle}>{subtitle}</span>}
    </div>
  );
}

/**
 * A table.
 *
 * @param props - The view, the outcomes and the time zone.
 * @param props.view - The table view.
 * @returns The table.
 */
function TableView({ view, queries, timeZone }: ViewProps & { readonly view: TableViewSpec }) {
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
            <tr key={row.key}>
              {row.cells.map((cell, index) => (
                <td
                  key={table.columns[index]?.label ?? index}
                  data-align={table.columns[index]?.align}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.truncated && (
        <p className={styles.note}>Showing the first {table.rows.length} rows.</p>
      )}
    </div>
  );
}

/** Props of {@link PanelView}. */
interface PanelViewProps extends ViewProps {
  /** The panel. */
  readonly panel: Panel;
  /** The annotation markers. */
  readonly markers: readonly MarkerOutcome[];
  /** The ids of the sets of markers not to draw. */
  readonly hiddenMarkers?: ReadonlySet<string> | undefined;
}

/**
 * The view of a panel, by kind.
 *
 * @param props - The panel, its outcomes and markers, the sets of markers hidden, and the time zone.
 * @returns The view.
 */
export function PanelView({ panel, queries, markers, hiddenMarkers, timeZone }: PanelViewProps) {
  const { view } = panel;
  const input = useMemo(() => {
    if (view.kind !== 'chart') return undefined;
    return chartInputOf(view, queries, shownMarkers(markers, hiddenMarkers));
  }, [view, queries, markers, hiddenMarkers]);
  if (view.kind === 'stat') return <StatView view={view} queries={queries} timeZone={timeZone} />;
  if (view.kind === 'table') return <TableView view={view} queries={queries} timeZone={timeZone} />;
  if (!input) return null;
  return (
    <Suspense fallback={<p className={styles.note}>Loading the chart…</p>}>
      <Chart input={input} timeZone={timeZone} label={panel.title} />
    </Suspense>
  );
}
