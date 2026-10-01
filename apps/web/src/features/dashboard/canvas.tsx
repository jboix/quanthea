/**
 * The working part of a dashboard: the variables with the Refresh button, and the panel grid. The pinned
 * view and the thread's draft pane both show it.
 */
import type { DashboardSpec, PanelRun } from '@quanthea/shared';
import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { Loaded } from './data.ts';
import { PanelCard, type RunTarget } from './panel-card.tsx';
import panelStyles from './panels.module.css';
import { RunStatus } from './run-status.tsx';
import { VariablesBar } from './variables-bar.tsx';
import { choicesFromSearch } from './view-state.ts';

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
}

/**
 * The panels of one version, on the grid.
 *
 * @param props - The canvas props, what to run, and the callback each finished run reports to.
 * @returns The grid.
 */
function PanelGrid(
  props: DashboardCanvasProps & {
    readonly target: RunTarget;
    readonly onRun: (panelId: string, run: Loaded<PanelRun>) => void;
  },
) {
  return (
    <div className={panelStyles.grid}>
      {props.spec.panels.map((panel) => (
        <PanelCard
          key={panel.id}
          panel={panel}
          spec={props.spec}
          target={props.target}
          onRun={props.onRun}
          selected={panel.id === props.selectedPanelId}
          marked={props.markedPanelIds?.includes(panel.id) ?? false}
          onSelect={props.onSelectPanel}
        />
      ))}
    </div>
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
  const target: RunTarget = { dashboardId, version, search: search.toString(), refresh };
  const { runs, report } = useRuns(`${dashboardId}@${version}?${target.search}#${refresh}`);
  const onRefresh = () => setRefresh((count) => count + 1);
  const actions = props.refreshable && <RunStatus spec={spec} runs={runs} onRefresh={onRefresh} />;
  return (
    <>
      <VariablesBar
        spec={spec}
        choices={choices}
        target={target}
        onSearch={setSearch}
        actions={actions}
      />
      <PanelGrid {...props} target={target} onRun={report} />
    </>
  );
}
