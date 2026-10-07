import type { DashboardSpec, PanelRun } from '@quanthea/shared';
import { Button } from '../../ui/button.tsx';
import { RefreshIcon, WarningIcon } from '../../ui/icons.tsx';
import { Tooltip } from '../../ui/tooltip.tsx';
import styles from './dashboard.module.css';
import type { Loaded } from './data.ts';

/** Props of {@link RunStatus}. */
interface RunStatusProps {
  /** The spec, for its panels and connectors. */
  readonly spec: DashboardSpec;
  /** The finished runs, by panel id. */
  readonly runs: Readonly<Record<string, Loaded<PanelRun>>>;
  /** Runs every panel again. */
  readonly onRefresh: () => void;
}

/**
 * The connectors the panels query, in words.
 *
 * @param spec - The spec.
 * @returns Such as `prometheus-dev and postgres-orders`.
 */
function connectorList(spec: DashboardSpec): string {
  const names = new Set(
    spec.panels.flatMap((panel) => panel.queries.map((query) => query.connector)),
  );
  return new Intl.ListFormat('en', { type: 'conjunction' }).format([...names]);
}

/**
 * Sums up the finished runs.
 *
 * @param runs - The runs.
 * @returns The number of queries, how many failed, and the slowest panel's duration.
 */
function summaryOf(runs: RunStatusProps['runs']) {
  const outcomes = Object.values(runs);
  const queries = outcomes.flatMap((run) => (run.ok ? run.value.queries : []));
  const failed =
    queries.filter((query) => query.error).length + outcomes.filter((run) => !run.ok).length;
  const durationMs = Math.max(0, ...outcomes.map((run) => (run.ok ? run.value.durationMs : 0)));
  return { queries: queries.length, failed, durationMs };
}

/**
 * What the refresh button's note says: what ran, against which connectors, how long it took, and
 * that no model was involved.
 *
 * @param spec - The spec.
 * @param runs - The finished runs.
 * @returns The tone and the note.
 */
function statusOf(spec: DashboardSpec, runs: RunStatusProps['runs']) {
  const done = Object.keys(runs).length >= spec.panels.length;
  const summary = summaryOf(runs);
  const saved = summary.queries === 1 ? 'saved query' : 'saved queries';
  const finished = summary.failed > 0 ? 'failed' : 'ok';
  const tone = done ? finished : 'running';
  const text = {
    running: `Running saved queries against ${connectorList(spec)}…`,
    ok: `Ran ${summary.queries} ${saved} against ${connectorList(spec)} in ${summary.durationMs} ms. No model call.`,
    failed: `${summary.failed} of ${summary.queries} ${saved} failed, in ${summary.durationMs} ms. No model call.`,
  }[tone];
  return { tone, text };
}

/**
 * The Refresh button, which runs every panel again. Its note says how the last run went; it turns
 * while the panels run and warns when a query failed.
 *
 * @param props - The spec, the finished runs and the refresh callback.
 * @returns The button with its note.
 */
export function RunStatus({ spec, runs, onRefresh }: RunStatusProps) {
  const { tone, text } = statusOf(spec, runs);
  return (
    <Tooltip text={text}>
      {(describedBy) => (
        <Button
          className={styles.refresh}
          data-tone={tone}
          aria-describedby={describedBy}
          aria-busy={tone === 'running'}
          aria-disabled={tone === 'running'}
          onClick={() => {
            if (tone !== 'running') onRefresh();
          }}
        >
          {tone === 'failed' ? <WarningIcon /> : <RefreshIcon />}
          Refresh
        </Button>
      )}
    </Tooltip>
  );
}
