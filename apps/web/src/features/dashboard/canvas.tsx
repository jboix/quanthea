/**
 * The working part of a dashboard: the variables with the Refresh button, and the panel grid. The pinned
 * view and the thread's draft pane both show it.
 */
import type { DashboardAlerts, DashboardSpec, PanelRun } from '@quanthea/shared';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { dashboardAlertsPath, useDashboardAlerts } from './alerts-data.ts';
import type { PanelMark } from './ask-marks.ts';
import type { Loaded } from './data.ts';
import { hiddenMarkersOf, runSearchOf } from './marker-sets.ts';
import type { PanelAlertView } from './panel-alert-view.tsx';
import { linkedAlertsOf, panelAlertsOf, type Selection, selectionOf } from './panel-alerts.ts';
import { PanelCard, type PanelPlanMark, type RunTarget } from './panel-card.tsx';
import panelStyles from './panels.module.css';
import { RunStatus } from './run-status.tsx';
import { VariablesBar } from './variables-bar.tsx';
import { choicesFromSearch, type ViewChoices } from './view-state.ts';

/** The finished runs of the panels, for one set of choices. */
interface RunsState {
  /** The choices the runs belong to. */
  readonly token: string;
  /** The finished runs, by panel id. */
  readonly runs: Readonly<Record<string, Loaded<PanelRun>>>;
}

/**
 * Collects the finished runs of the panels. Runs belong to a token; a new token starts over.
 *
 * @param token - Changes when the panels run again.
 * @returns The runs of the current token, and the callback the panels report to.
 */
function useRuns(token: string) {
  const [state, setState] = useState<RunsState>({ token, runs: {} });
  const report = useCallback(
    (panelId: string, run: Loaded<PanelRun>) =>
      setState((current) => {
        const runs = current.token === token ? current.runs : {};
        return runs[panelId] === run ? current : { token, runs: { ...runs, [panelId]: run } };
      }),
    [token],
  );
  return { runs: state.token === token ? state.runs : {}, report };
}

/** Props of {@link DashboardCanvas}. */
export interface DashboardCanvasProps {
  /** The dashboard. */
  readonly dashboardId: string;
  /** The version shown. */
  readonly version: number;
  /** Its spec. */
  readonly spec: DashboardSpec;
  /** Whether to show the Refresh button, with how the last run went, after the variables. */
  readonly refreshable?: boolean;
  /** The panel the inspector shows, if any. */
  readonly selectedPanelId?: string | undefined;
  /** Called when the person picks a panel, to inspect or mention it. */
  readonly onSelectPanel?: ((panelId: string) => void) | undefined;
  /** Panels the conversation is about, marked "in chat". */
  readonly markedPanelIds?: readonly string[];
  /** How a waiting plan would change each panel, by id, while the draft pane previews it. */
  readonly planMarks?: Readonly<Record<string, PanelPlanMark>> | undefined;
  /** What the open answer cites on each panel, by id: badges and shaded windows. */
  readonly answerMarks?: Readonly<Record<string, PanelMark>> | undefined;
  /** Whether the panels offer their explanations: on a pinned version only. */
  readonly explainable?: boolean;
  /** Whether the panels show their alerts: on the dashboard screen only. */
  readonly withAlerts?: boolean;
  /** A layer over the panels, such as the layout editor's frames. */
  readonly overlay?: ReactNode;
  /** A short note on some panels, by id, such as `hidden on v3` in the thread's draft pane. */
  readonly layoutNotes?: Readonly<Record<string, string>> | undefined;
}

/** The alerts on the panels, and the values chosen, once loaded. */
interface AlertsShown {
  /** The alerts on the dashboard's panels. */
  readonly data: DashboardAlerts | undefined;
  /** The values the viewer chose. */
  readonly selection: Selection;
}

/**
 * What each panel knows of its alerts, kept while the alerts and the choices stay the same, so the
 * charts are not built again.
 *
 * @param spec - The spec, for its panels.
 * @param shown - The alerts on the panels and the values chosen, if the panels show alerts.
 * @param pinnedVersion - The version shown, when it is pinned.
 * @returns Each panel's alerts, by panel id.
 */
function usePanelAlertViews(
  spec: DashboardSpec,
  shown: AlertsShown | undefined,
  pinnedVersion: number | undefined,
): ReadonlyMap<string, PanelAlertView> {
  return useMemo(() => {
    if (!shown) return new Map();
    const { data, selection } = shown;
    return new Map(
      spec.panels.map((panel) => {
        const alerts = panelAlertsOf(data, panel.id);
        return [panel.id, { alerts, selection, pinnedVersion }] as const;
      }),
    );
  }, [spec, shown, pinnedVersion]);
}

/**
 * The panels of one version, on the grid.
 *
 * @param props - The canvas props, what to run, the callback each finished run reports to, and the
 *   sets of markers the viewer hid.
 * @returns The grid.
 */
function PanelGrid(
  props: DashboardCanvasProps & {
    readonly target: RunTarget;
    readonly onRun: (panelId: string, run: Loaded<PanelRun>) => void;
    readonly hiddenMarkers: ReadonlySet<string>;
    readonly alerts: AlertsShown | undefined;
  },
) {
  const { dashboardId, version, spec } = props;
  const timeZone = spec.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const explain = props.explainable ? { dashboardId, version, timeZone } : undefined;
  const views = usePanelAlertViews(spec, props.alerts, props.explainable ? version : undefined);
  const grid = (
    <div className={panelStyles.grid}>
      {spec.panels.map((panel) => (
        <PanelCard
          key={panel.id}
          panel={panel}
          spec={props.spec}
          target={props.target}
          onRun={props.onRun}
          selected={panel.id === props.selectedPanelId}
          marked={props.markedPanelIds?.includes(panel.id) ?? false}
          onSelect={props.onSelectPanel}
          planMark={props.planMarks?.[panel.id]}
          answerMark={props.answerMarks?.[panel.id]}
          hiddenMarkers={props.hiddenMarkers}
          explain={explain}
          alerts={views.get(panel.id)}
          layoutNote={props.layoutNotes?.[panel.id]}
        />
      ))}
    </div>
  );
  return <WithOverlay overlay={props.overlay}>{grid}</WithOverlay>;
}

/**
 * The panel grid with a layer over it, when there is one.
 *
 * @param props - The grid and the layer.
 * @param props.overlay - The layer, if any.
 * @param props.children - The grid.
 * @returns The grid, under the layer.
 */
function WithOverlay({
  overlay,
  children,
}: {
  readonly overlay: ReactNode;
  readonly children: ReactNode;
}) {
  if (!overlay) return children;
  return (
    <div className={panelStyles.editing}>
      {children}
      {overlay}
    </div>
  );
}

/**
 * Loads the alerts on the panels over the range shown, when the panels show alerts.
 *
 * @param props - The canvas props.
 * @param choices - The viewer's choices.
 * @returns The alerts and the values chosen, or nothing.
 */
function useAlertsShown(
  props: DashboardCanvasProps,
  choices: ViewChoices,
): AlertsShown | undefined {
  const { dashboardId, spec, withAlerts } = props;
  const path = withAlerts ? dashboardAlertsPath(dashboardId, choices.time, spec.time) : undefined;
  const data = useDashboardAlerts(dashboardId, path);
  return useMemo(
    () => (withAlerts ? { data, selection: selectionOf(spec, choices) } : undefined),
    [withAlerts, data, spec, choices],
  );
}

/**
 * The variables bar, with Refresh when asked for, and the panels of one version.
 *
 * @param props - The version, and the selection and marks of the thread.
 * @returns The canvas.
 */
export function DashboardCanvas(props: DashboardCanvasProps) {
  const { dashboardId, version, spec } = props;
  const [search, setSearch] = useSearchParams();
  const [refresh, setRefresh] = useState(0);
  const choices = useMemo(() => choicesFromSearch(search, spec), [search, spec]);
  const hiddenMarkers = useMemo(() => hiddenMarkersOf(search, spec), [search, spec]);
  const target: RunTarget = { dashboardId, version, search: runSearchOf(search), refresh };
  const { runs, report } = useRuns(`${dashboardId}@${version}?${target.search}#${refresh}`);
  const alerts = useAlertsShown(props, choices);
  const onRefresh = () => setRefresh((count) => count + 1);
  const actions = props.refreshable && <RunStatus spec={spec} runs={runs} onRefresh={onRefresh} />;
  const shown = { search, hiddenMarkers, target, onSearch: setSearch, actions };
  return (
    <>
      <VariablesBar
        spec={spec}
        choices={choices}
        {...shown}
        alertSets={linkedAlertsOf(alerts?.data)}
      />
      <PanelGrid {...props} {...shown} onRun={report} alerts={alerts} />
    </>
  );
}
