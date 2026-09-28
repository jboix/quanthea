import type { PanelRun } from '@querent/shared';
import { useCallback, useMemo, useState } from 'react';
import { Link, useLoaderData, useSearchParams } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { LockIcon } from '../../ui/icons.tsx';
import { Pill } from '../../ui/pill.tsx';
import styles from './dashboard.module.css';
import { DashboardSidebar } from './dashboard-sidebar.tsx';
import type { DashboardData, Loaded } from './data.ts';
import { PanelCard, type RunTarget } from './panel-card.tsx';
import panelStyles from './panels.module.css';
import { RunBanner } from './run-banner.tsx';
import { VariablesBar } from './variables-bar.tsx';
import { choicesFromSearch } from './view-state.ts';

/**
 * Copies the page's address, and says so for two seconds.
 *
 * @returns The button.
 */
function CopyLinkButton() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return <Button onClick={() => void copy()}>{copied ? 'Copied' : 'Copy link'}</Button>;
}

/**
 * The top of the screen: where it sits, its title, its version and whether it is pinned.
 *
 * @param props - The dashboard and the version shown.
 * @returns The header.
 */
function DashboardHeader({ version }: DashboardData) {
  const pinned = version.pinnedAt !== null;
  return (
    <header className={styles.header}>
      <div className={styles.headerText}>
        <nav aria-label="Breadcrumb" className={styles.crumbs}>
          <Link to="/library">Library</Link> / {pinned ? 'pinned' : 'draft'}
        </nav>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{version.spec.title}</h1>
          <Pill mono tone={pinned ? 'neutral' : 'draft'}>
            {pinned && <LockIcon />}
            {pinned ? `pinned · v${version.version} · read-only` : `draft · v${version.version}`}
          </Pill>
        </div>
      </div>
      <CopyLinkButton />
    </header>
  );
}

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

/**
 * The state of the screen: the loaded version, the viewer's choices from the URL, the run target
 * and the finished runs.
 *
 * @returns The state and its setters.
 */
function useDashboardView() {
  const loaded = useLoaderData() as DashboardData;
  const { dashboard, version } = loaded;
  const [search, setSearch] = useSearchParams();
  const [refresh, setRefresh] = useState(0);
  const choices = useMemo(() => choicesFromSearch(search, version.spec), [search, version.spec]);
  const target: RunTarget = {
    dashboardId: dashboard.id,
    version: version.version,
    search: search.toString(),
    refresh,
  };
  const { runs, report } = useRuns(`${version.version}?${target.search}#${refresh}`);
  const refreshAll = () => setRefresh((count) => count + 1);
  return { loaded, choices, target, runs, report, refreshAll, setSearch };
}

/**
 * A dashboard: its variables, its panels running saved queries with no model involved, and its
 * sidebar.
 *
 * @returns The screen.
 */
export function DashboardScreen() {
  const { loaded, choices, target, runs, report, refreshAll, setSearch } = useDashboardView();
  const { spec } = loaded.version;
  return (
    <div className={styles.screen}>
      <DashboardHeader {...loaded} />
      <div className={styles.body}>
        <div className={styles.main}>
          <RunBanner spec={spec} runs={runs} onRefresh={refreshAll} />
          <VariablesBar spec={spec} choices={choices} target={target} onSearch={setSearch} />
          <div className={panelStyles.grid}>
            {spec.panels.map((panel) => (
              <PanelCard key={panel.id} panel={panel} spec={spec} target={target} onRun={report} />
            ))}
          </div>
        </div>
        <DashboardSidebar {...loaded} />
      </div>
    </div>
  );
}
