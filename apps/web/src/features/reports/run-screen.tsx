/**
 * A run of a report, frozen: its period, when it ran and where it went, its headline numbers and
 * panels drawn from the stored results through the layout of its version, the edit of that layout
 * for those who may arrange the active version, and the side panel to ask about it. Opening it runs no
 * query. Before a report's first run, the page shows the report with nothing to read yet.
 */
import type { ReportRunDetail } from '@quanthea/shared';
import { useMemo, useState } from 'react';
import { useLoaderData } from 'react-router';
import { Banner } from '../../ui/banner.tsx';
import { WarningIcon } from '../../ui/icons.tsx';
import { LeaveGuard, useArrangement } from '../dashboard/index.ts';
import type { RunData } from './data.ts';
import styles from './run.module.css';
import { arrangedRun, RunBody } from './run-body.tsx';
import { RunHeader } from './run-header.tsx';
import { RunSidePanel, type RunSideTab } from './run-side-panel.tsx';
import { useRecountUnseen } from './unseen.ts';
import { useReportChange } from './use-report-change.ts';

/**
 * What the page shows in place of results: why the run failed or is still running, or that there
 * is no run yet.
 *
 * @param props - The run, if any, and whether the reader may change the report.
 * @param props.run - The run.
 * @param props.canChange - Whether they may run or activate it.
 * @returns The note, or nothing for a run that succeeded.
 */
function NoResults({
  run,
  canChange,
}: {
  readonly run: ReportRunDetail | null;
  readonly canChange: boolean;
}) {
  if (run?.status === 'ok') return null;
  if (!run)
    return (
      <p className={styles.empty}>
        {canChange
          ? 'This report has not run yet. Run it now from Change, or activate it to put it on its schedule.'
          : 'This report has not run yet.'}
      </p>
    );
  const text =
    run.status === 'failed'
      ? 'This run has no results to show or ask about. The line above says why it failed.'
      : 'This run is still running. Its results show once it succeeds.';
  return (
    <Banner tone="warning" icon={<WarningIcon />}>
      {text}
    </Banner>
  );
}

/**
 * The run's panels as people see them, or as they are being arranged: the layout to draw them
 * through, the edit with its bar and its frames, and the way into the edit for those who may
 * arrange the active version. The edit is sent to the report's action.
 *
 * @param data - The report and the run shown.
 * @returns The layout shown, the edit, its bar and overlay, and Edit layout's callback if offered.
 */
function useArrangedRun({ report, run }: RunData) {
  const { arranged, allowed } = useMemo(() => arrangedRun(report, run), [report, run]);
  const action = `/reports/${encodeURIComponent(report.id)}`;
  return useArrangement(arranged, allowed, {
    action,
    history: `${action}/v/${arranged.version}/layouts`,
  });
}

/**
 * A run's page. While the layout is arranged, its bar takes the place of the header's actions and
 * the side panel closes.
 *
 * @returns The screen.
 */
export function RunScreen() {
  const data = useLoaderData() as RunData;
  const { report, run } = data;
  useRecountUnseen(run?.id);
  const { refusal } = useReportChange(report.id);
  const view = useArrangedRun(data);
  const [side, setSide] = useState<RunSideTab | null>(null);
  const ok = run?.status === 'ok' ? run : null;
  const shownSide = ok && view.editor.draft === null ? side : null;
  const closeSide = () => setSide(null);
  const header = { onAsk: ok ? () => setSide('ask') : undefined, asking: shownSide !== null };
  return (
    <div className={styles.screen}>
      <div className={styles.content}>
        <RunHeader
          {...data}
          {...header}
          onArrange={view.onArrange}
          bar={view.bar}
          notes={view.notes}
        />
        <div className={styles.main}>
          {refusal && <p className={styles.failure}>{refusal}</p>}
          <NoResults run={run} canChange={report.canChange} />
          {ok && <RunBody run={ok} layout={view.layout} overlay={view.overlay} />}
        </div>
      </div>
      <LeaveGuard dirty={view.editor.dirty} />
      {shownSide && ok && (
        <RunSidePanel key={ok.id} run={ok} tab={shownSide} onTab={setSide} onClose={closeSide} />
      )}
    </div>
  );
}
