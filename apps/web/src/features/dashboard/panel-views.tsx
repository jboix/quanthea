import type { MarkerOutcome, Panel, QueryOutcome } from '@quanthea/shared';
import { lazy, Suspense, useMemo } from 'react';
import {
  type AlertMarks,
  type ChartHighlight,
  type ChartPeriod,
  chartInputOf,
  chartPeriodOf,
} from '../../charts/input.ts';
import { shownMarkers } from './marker-sets.ts';
import styles from './panels.module.css';
import { StatView } from './stat-view.tsx';
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
