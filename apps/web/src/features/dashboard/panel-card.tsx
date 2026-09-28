import type { DashboardSpec, Panel, PanelRun } from '@querent/shared';
import { type CSSProperties, useEffect } from 'react';
import { useFetcher } from 'react-router';
import type { Loaded } from './data.ts';
import { PanelView } from './panel-views.tsx';
import styles from './panels.module.css';

/** Where the panels of a version load from, and with which choices. */
export interface RunTarget {
  /** The dashboard. */
  readonly dashboardId: string;
  /** The version. */
  readonly version: number;
  /** The choices as URL parameters: `from`, `to`, `var-…`. */
  readonly search: string;
  /** Counts the viewer's refreshes; each one runs the panels again. */
  readonly refresh: number;
}

/** Props of {@link PanelCard}. */
interface PanelCardProps {
  /** The panel. */
  readonly panel: Panel;
  /** The spec, for its time zone. */
  readonly spec: DashboardSpec;
  /** What to run. */
  readonly target: RunTarget;
  /** Receives each finished run, for the status line. */
  readonly onRun: (panelId: string, run: Loaded<PanelRun>) => void;
}

/**
 * Loads a panel's run whenever the target changes, and reports each finished run.
 *
 * @param panel - The panel.
 * @param target - What to run.
 * @param onRun - Receives each finished run.
 * @returns The latest run, and whether one is loading.
 */
function usePanelRun(panel: Panel, target: RunTarget, onRun: PanelCardProps['onRun']) {
  const base = `/d/${target.dashboardId}/v/${target.version}/panels/${panel.id}`;
  const fetcher = useFetcher<Loaded<PanelRun>>({ key: `panel-${base}` });
  const { load, data, state } = fetcher;
  const search = new URLSearchParams(target.search);
  if (target.refresh > 0) search.set('refresh', String(target.refresh));
  const url = search.size === 0 ? base : `${base}?${search}`;
  useEffect(() => {
    void load(url);
  }, [load, url]);
  useEffect(() => {
    if (state === 'idle' && data) onRun(panel.id, data);
  }, [state, data, onRun, panel.id]);
  return { run: data, loading: state !== 'idle' || data === undefined };
}

/**
 * The body of a panel: its view, or why it has nothing to show.
 *
 * @param props - The panel, the spec and the run.
 * @param props.run - The latest run, if any.
 * @param props.loading - Whether a run is loading.
 * @returns The body.
 */
function PanelBody({
  panel,
  spec,
  run,
  loading,
}: Pick<PanelCardProps, 'panel' | 'spec'> & ReturnType<typeof usePanelRun>) {
  if (!run) return <p className={styles.loading}>Loading…</p>;
  if (!run.ok) return <p className={styles.error}>{run.message}</p>;
  const failures = run.value.queries.filter((query) => query.error);
  const empty = run.value.queries.every((query) =>
    query.frames.every((frame) => frame.meta.rowCount === 0),
  );
  return (
    <>
      {failures.map((query) => (
        <p key={query.refId} className={styles.error}>
          {run.value.queries.length > 1 ? `${query.refId}: ` : ''}
          {query.error?.message}
        </p>
      ))}
      {failures.length < run.value.queries.length && empty && panel.view.kind !== 'stat' ? (
        <p className={styles.empty}>No data in this range.</p>
      ) : (
        <div className={styles.view} data-loading={loading}>
          <PanelView
            panel={panel}
            queries={run.value.queries}
            markers={run.value.markers}
            timeZone={spec.timezone}
          />
        </div>
      )}
    </>
  );
}

/**
 * One panel on the grid: its title and its view, loading and failing on its own.
 *
 * @param props - The panel, the spec, what to run, and the run callback.
 * @returns The panel card.
 */
export function PanelCard({ panel, spec, target, onRun }: PanelCardProps) {
  const { run, loading } = usePanelRun(panel, target, onRun);
  const { x, y, w, h } = panel.grid;
  return (
    <section
      className={styles.panel}
      data-kind={panel.view.kind}
      aria-labelledby={`panel-${panel.id}`}
      aria-busy={loading}
      style={
        {
          '--column': `${x + 1} / span ${w}`,
          '--row': `${y + 1} / span ${h}`,
          '--rows': h,
        } as CSSProperties
      }
    >
      <h3 id={`panel-${panel.id}`} className={styles.title} title={panel.description}>
        {panel.title}
      </h3>
      <PanelBody panel={panel} spec={spec} run={run} loading={loading} />
    </section>
  );
}
