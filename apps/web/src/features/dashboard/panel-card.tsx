import type { DashboardSpec, Panel, PanelRun } from '@quanthea/shared';
import { type CSSProperties, useEffect, useMemo } from 'react';
import { useFetcher } from 'react-router';
import type { PanelMark } from './ask-marks.ts';
import type { Loaded } from './data.ts';
import { PanelAlertPill, type PanelAlertView } from './panel-alert-view.tsx';
import { alertMarksOf } from './panel-alerts.ts';
import type { ExplainPlace } from './panel-explain.tsx';
import { PanelInfo } from './panel-info.tsx';
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
/** How a waiting plan would change a panel, for the draft pane's preview. */
export interface PanelPlanMark {
  /** What the plan does to it. */
  readonly tag: 'changed' | 'removed' | 'same';
  /** What changes, for a changed panel. */
  readonly note?: string;
}

/** The words of each mark, as the panel shows them. */
const planMarkWords: Readonly<Record<PanelPlanMark['tag'], string>> = {
  changed: 'changed',
  removed: 'removed',
  same: 'kept',
};

/** What a marked panel says under its title. */
const planMarkNotes: Readonly<Record<PanelPlanMark['tag'], string>> = {
  changed: 'Current chart · rebuilds after approval',
  removed: 'Leaves the dashboard after approval',
  same: '',
};

interface PanelCardProps {
  /** The panel. */
  readonly panel: Panel;
  /** The spec, for its time zone. */
  readonly spec: DashboardSpec;
  /** What to run. */
  readonly target: RunTarget;
  /** Receives each finished run, for the status line. */
  readonly onRun: (panelId: string, run: Loaded<PanelRun>) => void;
  /** Whether the inspector shows this panel. */
  readonly selected?: boolean;
  /** Whether the conversation is about this panel. */
  readonly marked?: boolean;
  /** Called when the person picks the panel, if panels can be picked. */
  readonly onSelect?: ((panelId: string) => void) | undefined;
  /** How a waiting plan would change the panel, while the draft pane previews it. */
  readonly planMark?: PanelPlanMark | undefined;
  /** The ids of the sets of markers the viewer hid, which the chart does not draw. */
  readonly hiddenMarkers?: ReadonlySet<string> | undefined;
  /** What the open answer cites on the panel: badges, and windows to shade on a time chart. */
  readonly answerMark?: PanelMark | undefined;
  /** Where the panel's explanation is kept, on a pinned version; left out elsewhere. */
  readonly explain?: ExplainPlace | undefined;
  /** The panel's alerts, on the dashboard screen; left out elsewhere. */
  readonly alerts?: PanelAlertView | undefined;
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
 * What the panel's linked alerts draw on its time chart, kept while they and the hidden sets stay
 * the same.
 *
 * @param alerts - The panel's alerts, if it shows them.
 * @param hiddenMarkers - The sets of markers the viewer hid.
 * @returns The marks, if any.
 */
function useAlertMarks(
  alerts: PanelAlertView | undefined,
  hiddenMarkers: ReadonlySet<string> | undefined,
) {
  return useMemo(() => {
    if (!alerts) return undefined;
    const hidden = hiddenMarkers ?? new Set<string>();
    return alertMarksOf(alerts.alerts.linked, alerts.selection, hidden, Date.now());
  }, [alerts, hiddenMarkers]);
}

/**
 * The body of a panel: its view, or why it has nothing to show.
 *
 * @param props - The panel, the spec, the hidden sets of markers, the answer's marks, the alerts
 *   and the run.
 * @param props.run - The latest run, if any.
 * @param props.loading - Whether a run is loading.
 * @returns The body.
 */
function PanelBody({
  panel,
  spec,
  hiddenMarkers,
  answerMark,
  alerts,
  run,
  loading,
}: Pick<PanelCardProps, 'panel' | 'spec' | 'hiddenMarkers' | 'answerMark' | 'alerts'> &
  ReturnType<typeof usePanelRun>) {
  const alertMarks = useAlertMarks(alerts, hiddenMarkers);
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
            hiddenMarkers={hiddenMarkers}
            highlights={answerMark?.windows}
            alertMarks={alertMarks}
            timeZone={spec.timezone}
          />
        </div>
      )}
    </>
  );
}

/**
 * The heading of a panel: its title, as a button when panels can be picked, the "in chat" mark,
 * the numbers the open answer cites it with, the pill of its alerts, and its info bubble: its
 * explanation on a pinned version, its alerts, and where its data comes from.
 *
 * @param props - The panel, whether it is marked, the pick callback, the marks, where its
 *   explanation is kept and its alerts.
 * @returns The heading.
 */
function PanelHeading({
  panel,
  marked,
  onSelect,
  planMark,
  answerMark,
  explain,
  alerts,
}: Pick<
  PanelCardProps,
  'panel' | 'marked' | 'onSelect' | 'planMark' | 'answerMark' | 'explain' | 'alerts'
>) {
  const title = onSelect ? (
    <button type="button" className={styles.titleButton} onClick={() => onSelect(panel.id)}>
      {panel.title}
    </button>
  ) : (
    panel.title
  );
  return (
    <div className={styles.heading}>
      <h3 id={`panel-${panel.id}`} className={styles.title} title={panel.description}>
        {title}
      </h3>
      {marked && <span className={styles.mark}>in chat</span>}
      {planMark && <span className={styles.planTag}>{planMarkWords[planMark.tag]}</span>}
      {answerMark?.numbers.map((n) => (
        <span key={n} className={styles.answerMark} title="Cited in the open answer">
          {n}
        </span>
      ))}
      {alerts && <PanelAlertPill view={alerts} />}
      <PanelInfo panel={panel} explain={explain} alerts={alerts} />
    </div>
  );
}

/**
 * What a waiting plan does to the panel, under its title: the change, and what happens next.
 *
 * @param props - The mark.
 * @param props.mark - How the plan changes the panel.
 * @returns The note, or nothing for a kept panel.
 */
function PlanNote({ mark }: { readonly mark: PanelPlanMark }) {
  if (mark.tag === 'same') return null;
  const note = mark.note ? `${mark.note} · ` : '';
  return (
    <p className={styles.planNote}>
      {note}
      {planMarkNotes[mark.tag]}
    </p>
  );
}

/** Props of {@link PanelFrame}. */
type PanelFrameProps = Omit<PanelCardProps, 'target' | 'onRun'> & {
  /** The run to show, if it has finished. */
  readonly run: Loaded<PanelRun> | undefined;
  /** Whether a run is loading. */
  readonly loading: boolean;
};

/**
 * One panel on the grid, around a run it is given: its title, any plan mark, and its view.
 *
 * @param props - The panel, the spec, the run, its selection and marks, the hidden sets of
 *   markers, and what the open answer cites on it.
 * @returns The panel card.
 */
export function PanelFrame(props: PanelFrameProps) {
  const { panel, loading, selected = false, planMark, answerMark } = props;
  return (
    <section
      className={styles.panel}
      data-kind={panel.view.kind}
      data-selected={selected}
      data-plan={planMark?.tag}
      data-cited={answerMark !== undefined}
      aria-labelledby={`panel-${panel.id}`}
      aria-busy={loading}
      style={gridPlace(panel)}
    >
      <PanelHeading {...props} />
      {planMark && <PlanNote mark={planMark} />}
      <PanelBody {...props} />
    </section>
  );
}

/**
 * Where a panel sits on the grid, as the custom properties the stylesheet reads.
 *
 * @param panel - The panel.
 * @returns The style.
 */
function gridPlace(panel: Panel): CSSProperties {
  const { x, y, w, h } = panel.grid;
  return {
    '--column': `${x + 1} / span ${w}`,
    '--row': `${y + 1} / span ${h}`,
    '--rows': h,
  } as CSSProperties;
}

/**
 * One panel on the grid: its title and its view, loading and failing on its own.
 *
 * @param props - The panel, the spec, what to run, the run callback, its selection, and the sets of
 *   markers the viewer hid.
 * @returns The panel card.
 */
export function PanelCard({ target, onRun, ...props }: PanelCardProps) {
  const { run, loading } = usePanelRun(props.panel, target, onRun);
  return <PanelFrame {...props} run={run} loading={loading} />;
}

/**
 * The latest run of a panel, read from the fetcher its card loads through.
 *
 * @param dashboardId - The dashboard.
 * @param version - The version.
 * @param panelId - The panel.
 * @returns The run, if it has finished.
 */
export function usePanelRunData(
  dashboardId: string,
  version: number,
  panelId: string,
): Loaded<PanelRun> | undefined {
  return useFetcher<Loaded<PanelRun>>({
    key: `panel-/d/${dashboardId}/v/${version}/panels/${panelId}`,
  }).data;
}
