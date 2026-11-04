/**
 * The working part of a dashboard: the variables with the Refresh button, and the panel grid. The pinned
 * view and the thread's draft pane both show it.
 */
import type {
  DashboardAlerts,
  DashboardSpec,
  ExternalHosts,
  Panel,
  PanelRun,
} from '@quanthea/shared';
import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { RangeSelectContext, type RangeSelected } from '../../charts/range-select.tsx';
import { dashboardAlertsPath, useDashboardAlerts } from './alerts-data.ts';
import { ArrangedSections, type SectionArranging } from './arranged-sections.tsx';
import type { PanelMark } from './ask-marks.ts';
import { CanvasActions } from './canvas-actions.tsx';
import type { Loaded } from './data.ts';
import { ImageHostsContext } from './image-hosts.ts';
import { type Linkable, type PanelLinks, panelLinksOf } from './links.ts';
import { hiddenMarkersOf, runSearchOf } from './marker-sets.ts';
import type { PanelAlertView } from './panel-alert-view.tsx';
import { linkedAlertsOf, panelAlertsOf, type Selection, selectionOf } from './panel-alerts.ts';
import { PanelCard, type PanelPlanMark, type RunTarget } from './panel-card.tsx';
import { copyTarget, type SectionCopy } from './section-copies.tsx';
import { type Folding, SectionedGrid, useFolding } from './sections.tsx';
import { VariablesBar } from './variables-bar.tsx';
import { choicesFromSearch, type ViewChoices, withTime } from './view-state.ts';

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
  /**
   * Where its links may go: the dashboards pinned now and the hosts allowed. Left out, as in a
   * thread's draft, its tables and stats show their links as text.
   */
  readonly linkable?: Linkable | undefined;
  /** The hosts an admin allowed, for the images its tables show; left out, they show text. */
  readonly hosts?: ExternalHosts | undefined;
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
  /** The layout being arranged, which draws the sections open with their frames. */
  readonly arranging?: SectionArranging | undefined;
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

/** Props of {@link PanelGrid}: the canvas props and what the canvas works out for its panels. */
interface PanelGridProps extends DashboardCanvasProps {
  /** What to run. */
  readonly target: RunTarget;
  /** Called with each finished run. */
  readonly onRun: (panelId: string, run: Loaded<PanelRun>) => void;
  /** The sets of markers the viewer hid. */
  readonly hiddenMarkers: ReadonlySet<string>;
  /** The alerts shown on the panels. */
  readonly alerts: AlertsShown | undefined;
  /** What the links of tables and stats are built from. */
  readonly links: PanelLinks | undefined;
  /** Which sections the viewer folded. */
  readonly folding: Folding;
}

/**
 * Where a panel's Explain asks, when the canvas offers it.
 *
 * @param props - The canvas props: the dashboard, the version, the spec and whether to explain.
 * @returns The place, or `undefined` when the canvas offers no Explain.
 */
function explainPlace(
  props: Pick<DashboardCanvasProps, 'dashboardId' | 'version' | 'spec' | 'explainable'>,
) {
  if (!props.explainable) return undefined;
  const timeZone = props.spec.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return { dashboardId: props.dashboardId, version: props.version, timeZone };
}

/**
 * The panels of one version, on the grid.
 *
 * @param props - The canvas props, what to run, the callback each finished run reports to, the
 *   sets of markers the viewer hid, the alerts and the links.
 * @returns The grid.
 */
function PanelGrid(props: PanelGridProps) {
  const { version, spec } = props;
  const explain = explainPlace(props);
  const views = usePanelAlertViews(spec, props.alerts, props.explainable ? version : undefined);
  const card = cardDrawer(props, explain, views);
  if (props.arranging) return <ArrangedSections {...props.arranging} spec={spec} card={card} />;
  return <SectionedGrid spec={spec} folding={props.folding} card={card} target={props.target} />;
}

/**
 * How the grid draws one panel.
 *
 * @param props - The grid's props.
 * @param explain - Where a panel's Explain asks, if the canvas offers it.
 * @param views - Each panel's alerts, by id.
 * @returns A function that draws a panel's card.
 */
function cardDrawer(
  props: PanelGridProps,
  explain: ReturnType<typeof explainPlace>,
  views: ReadonlyMap<string, PanelAlertView>,
) {
  return (panel: Panel, copy?: SectionCopy) => (
    <PanelCard
      key={panel.id}
      panel={panel}
      spec={props.spec}
      target={copy ? copyTarget(props.target, copy) : props.target}
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
      links={props.links}
    />
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
  const folding = useFolding(spec);
  const actions = (
    <CanvasActions
      spec={folding.shown}
      runs={runs}
      {...{ onRefresh, refreshable: props.refreshable }}
    />
  );
  const shown = { search, hiddenMarkers, target, onSearch: setSearch, actions };
  const alertSets = linkedAlertsOf(alerts?.data);
  const selectTime = useTimeSelect(search, setSearch);
  const links = useLinks(props, search);
  return (
    <>
      <VariablesBar spec={spec} choices={choices} {...shown} alertSets={alertSets} />
      <RangeSelectContext value={selectTime}>
        <ImageHostsContext value={props.hosts}>
          <PanelGrid {...props} {...shown} {...{ alerts, links, folding }} onRun={report} />
        </ImageHostsContext>
      </RangeSelectContext>
    </>
  );
}

/**
 * What the panels' links are built from, kept while the choices stay the same.
 *
 * @param props - The canvas props: the spec and the dashboards pinned now.
 * @param search - The search parameters.
 * @returns What the links are built from, or `undefined` when the canvas draws none.
 */
function useLinks(
  props: Pick<DashboardCanvasProps, 'spec' | 'linkable'>,
  search: URLSearchParams,
): PanelLinks | undefined {
  const { spec, linkable } = props;
  const text = search.toString();
  return useMemo(
    () => (linkable ? panelLinksOf(spec, text, linkable) : undefined),
    [spec, text, linkable],
  );
}

/**
 * What selecting a stretch of a time chart does: it becomes the dashboard's time range, in the
 * URL, so Back goes to the range before.
 *
 * @param search - The search parameters.
 * @param setSearch - Sets them.
 * @returns The selection callback.
 */
function useTimeSelect(
  search: URLSearchParams,
  setSearch: (next: URLSearchParams) => void,
): RangeSelected {
  return useCallback(
    (from, to) => {
      const time = { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
      setSearch(withTime(search, time));
    },
    [search, setSearch],
  );
}
