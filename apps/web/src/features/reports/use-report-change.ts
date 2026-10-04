/** Submits a change to a report's action, one fetcher shared by the run page's menus. */
import { type SubmitTarget, useFetcher } from 'react-router';
import type { ReportIntent, ReportOutcome } from './data.ts';

/** The key of the fetcher the menus share, so the page shows the last refusal. */
const changeKey = 'report-change';

/**
 * The run page's change fetcher. Run now opens the new run once it is made.
 *
 * @param reportId - The report.
 * @returns The submitter, whether it is busy, and the last refusal.
 */
export function useReportChange(reportId: string) {
  const fetcher = useFetcher<ReportOutcome>({ key: changeKey });
  const submit = (intent: ReportIntent) =>
    void fetcher.submit(intent as SubmitTarget, {
      method: 'post',
      action: `/reports/${encodeURIComponent(reportId)}`,
      encType: 'application/json',
    });
  const refusal = fetcher.data?.ok === false ? fetcher.data.message : undefined;
  return { submit, busy: fetcher.state !== 'idle', refusal };
}
