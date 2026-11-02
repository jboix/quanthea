import type { DashboardSpec, PanelRun } from '@quanthea/shared';
import { useMemo } from 'react';
import type { Loaded } from './data.ts';
import { LoadProgress } from './load-progress.tsx';
import { RunStatus } from './run-status.tsx';

/**
 * How far the panels drawn have run, and Refresh when asked for. A panel of a folded section is
 * not drawn, so it counts neither as done nor as waiting; the copies of a repeated section count
 * their runs under their panel.
 *
 * @param props - The spec with the panels drawn, the runs, and Refresh.
 * @param props.spec - The spec, with only the panels drawn.
 * @param props.runs - The latest run of each panel, by id.
 * @param props.refreshable - Whether to show Refresh.
 * @param props.onRefresh - Runs every panel again.
 * @returns The progress and Refresh.
 */
export function CanvasActions({
  spec,
  runs,
  refreshable,
  onRefresh,
}: {
  readonly spec: DashboardSpec;
  readonly runs: Readonly<Record<string, Loaded<PanelRun>>>;
  readonly refreshable: boolean | undefined;
  readonly onRefresh: () => void;
}) {
  const shownRuns = useMemo(() => {
    const drawn = new Set(spec.panels.map((panel) => panel.id));
    // A copy of a repeated section reports its runs as the panel's id, `#` and its value.
    return Object.fromEntries(
      Object.entries(runs).filter(([key]) => drawn.has(key.split('#')[0] ?? '')),
    );
  }, [spec, runs]);
  return (
    <>
      <LoadProgress done={Object.keys(shownRuns).length} total={spec.panels.length} />
      {refreshable && <RunStatus spec={spec} runs={shownRuns} onRefresh={onRefresh} />}
    </>
  );
}
