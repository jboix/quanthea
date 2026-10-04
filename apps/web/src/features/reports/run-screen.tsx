/**
 * A run of a report, frozen: its period, when it ran and where it went, its headline numbers and
 * panels drawn from the stored results, and the side panel to ask about it. Opening it runs no
 * query. Before a report's first run, the page shows the report with nothing to read yet.
 */
import { hasRole, type ReportRunDetail } from '@quanthea/shared';
import { useState } from 'react';
import { useLoaderData } from 'react-router';
import { Banner } from '../../ui/banner.tsx';
import { WarningIcon } from '../../ui/icons.tsx';
import type { RunData } from './data.ts';
import styles from './run.module.css';
import { RunBody } from './run-body.tsx';
import { RunHeader } from './run-header.tsx';
import { RunSidePanel, type RunSideTab } from './run-side-panel.tsx';
import { useRecountUnseen } from './unseen.ts';
import { useReportChange } from './use-report-change.ts';
import { useRole } from './use-role.ts';

/**
 * What the page shows in place of results: why the run failed or is still running, or that there
 * is no run yet.
 *
 * @param props - The run, if any.
 * @param props.run - The run.
 * @returns The note, or nothing for a run that succeeded.
 */
function NoResults({ run }: { readonly run: ReportRunDetail | null }) {
  const editor = hasRole(useRole(), 'editor');
  if (run?.status === 'ok') return null;
  if (!run)
    return (
      <p className={styles.empty}>
        {editor
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
 * A run's page.
 *
 * @returns The screen.
 */
export function RunScreen() {
  const { report, run } = useLoaderData() as RunData;
  useRecountUnseen(run?.id);
  const { refusal } = useReportChange(report.id);
  const [side, setSide] = useState<RunSideTab | null>(null);
  const askable = run?.status === 'ok';
  const shownSide = askable ? side : null;
  return (
    <div className={styles.screen}>
      <div className={styles.content}>
        <RunHeader
          report={report}
          run={run}
          onAsk={askable ? () => setSide('ask') : undefined}
          asking={shownSide !== null}
        />
        <div className={styles.main}>
          {refusal && <p className={styles.failure}>{refusal}</p>}
          <NoResults run={run} />
          {run?.status === 'ok' && <RunBody run={run} />}
        </div>
      </div>
      {shownSide && run && (
        <RunSidePanel
          key={run.id}
          run={run}
          tab={shownSide}
          onTab={setSide}
          onClose={() => setSide(null)}
        />
      )}
    </div>
  );
}
