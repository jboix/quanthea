import type { DashboardSpec, PanelRun } from '@querent/shared';
import { Button } from '../../ui/button.tsx';
import { CheckIcon, WarningIcon } from '../../ui/icons.tsx';
import styles from './dashboard.module.css';
import type { Loaded } from './data.ts';

/** Props of {@link RunBanner}. */
interface RunBannerProps {
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
function summaryOf(runs: RunBannerProps['runs']) {
  const outcomes = Object.values(runs);
  const queries = outcomes.flatMap((run) => (run.ok ? run.value.queries : []));
  const failed =
    queries.filter((query) => query.error).length + outcomes.filter((run) => !run.ok).length;
  const durationMs = Math.max(0, ...outcomes.map((run) => (run.ok ? run.value.durationMs : 0)));
  return { queries: queries.length, failed, durationMs };
}

/**
 * The line above the panels: what ran, against which connectors, how long it took, and that no
 * model was involved.
 *
 * @param props - The spec, the finished runs and the refresh callback.
 * @returns The banner.
 */
export function RunBanner({ spec, runs, onRefresh }: RunBannerProps) {
  const done = Object.keys(runs).length >= spec.panels.length;
  const summary = summaryOf(runs);
  const saved = summary.queries === 1 ? 'saved query' : 'saved queries';
  const tone = !done ? 'running' : summary.failed > 0 ? 'failed' : 'ok';
  const text = {
    running: `Running saved queries against ${connectorList(spec)}…`,
    ok: `Ran ${summary.queries} ${saved} directly against ${connectorList(spec)} · ${summary.durationMs} ms · no model call`,
    failed: `${summary.failed} of ${summary.queries} ${saved} failed · ${summary.durationMs} ms · no model call`,
  }[tone];
  return (
    <div className={styles.banner} data-tone={tone} role="status">
      {tone === 'failed' ? <WarningIcon /> : <CheckIcon />}
      <span className={styles.bannerText}>{text}</span>
      <Button size="small" onClick={onRefresh} disabled={!done}>
        Refresh
      </Button>
    </div>
  );
}
