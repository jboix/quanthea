import {
  createFormatter,
  type MarkerOutcome,
  type Panel,
  type QueryOutcome,
  reduceResult,
  type StatView as StatViewSpec,
} from '@quanthea/shared';
import { lazy, Suspense, useMemo } from 'react';
import {
  type AlertMarks,
  type ChartHighlight,
  type ChartPeriod,
  chartInputOf,
  chartPeriodOf,
} from '../../charts/input.ts';
import { fittedNumber } from '../../ui/fitted-number.ts';
import { shownMarkers } from './marker-sets.ts';
import styles from './panels.module.css';
import { TableView } from './table-view.tsx';

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
      <span className={styles.statValue} style={fittedNumber(value || '–', 32)}>
        {value || '–'}
      </span>
      {subtitle !== '' && <span className={styles.statSubtitle}>{subtitle}</span>}
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
  /** Windows an open answer cites, shaded on a time chart. */
  readonly highlights?: readonly ChartHighlight[] | undefined;
  /** The thresholds and firing periods of the alerts linked to the panel, on a time chart. */
  readonly alertMarks?: AlertMarks | undefined;
  /**
   * The time range the panel ran over, as its run gives it: a time chart shows all of it. Without
   * it, as for a sample, the time axis is left to the data.
   */
  readonly period?: ChartPeriod | undefined;
}

/**
 * The view of a panel, by kind.
 *
 * @param props - The panel, its outcomes and markers, the sets of markers hidden, the windows an
 *   open answer cites, the linked alerts' marks, the time range it ran over, and the time zone.
 * @returns The view.
 */
export function PanelView({
  panel,
  queries,
  markers,
  hiddenMarkers,
  highlights,
  alertMarks,
  period,
  timeZone,
}: PanelViewProps) {
  const { view } = panel;
  const from = period?.from;
  const to = period?.to;
  const input = useMemo(() => {
    if (view.kind !== 'chart') return undefined;
    const shown = shownMarkers(markers, hiddenMarkers);
    const time = from === undefined || to === undefined ? undefined : { from, to };
    const drawn = chartInputOf(view, queries, shown, highlights, alertMarks);
    return { ...drawn, period: chartPeriodOf(panel, time) };
  }, [panel, view, queries, markers, hiddenMarkers, highlights, alertMarks, from, to]);
  if (view.kind === 'stat') return <StatView view={view} queries={queries} timeZone={timeZone} />;
  if (view.kind === 'table') return <TableView view={view} queries={queries} timeZone={timeZone} />;
  if (!input) return null;
  return (
    <Suspense fallback={<p className={styles.note}>Loading the chart…</p>}>
      <Chart input={input} timeZone={timeZone} label={panel.title} />
    </Suspense>
  );
}
