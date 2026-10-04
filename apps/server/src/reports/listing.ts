/**
 * The reports list as one person reads it: each report with its latest run, whether a finished run
 * exists that the person has not opened, and the history of its first headline number over the
 * latest successful runs, read from the stored runs. No query runs.
 */
import {
  type ReportListItem,
  type ReportSpec,
  type Role,
  reportHistoryRuns,
} from '@quanthea/shared';
import type { RunSummaryRow } from '../db/report-run-repository.ts';
import type { ReportsContext } from './context.ts';
import { toReportSummary, toRunSummary, versionSpecs, visibleVersions } from './views.ts';

/** What the list reads of a report's runs, by version. */
type SpecOf = (version: number) => ReportSpec | undefined;

/**
 * Whether a person has a finished run of a report to open: one made after the latest run they
 * opened. Run ids are ULIDs, so a later run has a greater id.
 *
 * @param runs - The report's latest runs the person may see.
 * @param seen - The latest run they opened, if any.
 * @returns Whether one is new to them.
 */
export function hasUnseenRun(runs: readonly RunSummaryRow[], seen: string | undefined): boolean {
  return runs.some((run) => run.status !== 'running' && (seen === undefined || run.id > seen));
}

/**
 * The first headline number over the successful runs, oldest first. Runs whose first headline is
 * another panel's, after the spec changed, are left out.
 *
 * @param runs - The report's latest runs, the latest period first.
 * @param specOf - The spec of each version.
 * @returns Each run's id, period and number.
 */
export function headlineHistory(runs: readonly RunSummaryRow[], specOf: SpecOf) {
  const points = runs.flatMap((run) => {
    const spec = specOf(run.version);
    if (run.status !== 'ok' || !spec) return [];
    const summary = toRunSummary(run, spec);
    const [first] = summary.headlines;
    if (!first) return [];
    return [
      { panelId: first.panelId, runId: run.id, label: summary.period.label, value: first.value },
    ];
  });
  const panelId = points[0]?.panelId;
  return points
    .filter((point) => point.panelId === panelId)
    .reverse()
    .map(({ runId, label, value }) => ({ runId, label, value }));
}

/**
 * Lists the reports a role may see, as one person reads them.
 *
 * @param context - The service context.
 * @param role - The role.
 * @param readerId - Who reads, by user id.
 * @returns The reports, the newest first.
 */
export function listForReader(
  context: ReportsContext,
  role: Role,
  readerId: string,
): ReportListItem[] {
  const seen = context.seen?.seenBy(readerId) ?? new Map<string, string>();
  return context.repository.list().flatMap((report) => {
    const versions = versionSpecs(context, report.id);
    const allowed = visibleVersions(versions, role);
    // Below editor, a report shows once a version is active.
    if (allowed !== null && report.activeVersion === null) return [];
    const runs = context.runs.list(report.id, { versions: allowed, limit: reportHistoryRuns });
    const specOf: SpecOf = (version) => versions.get(version)?.spec;
    return [
      {
        ...toReportSummary(report, versions, role, runs[0]),
        unseen: hasUnseenRun(runs, seen.get(report.id)),
        history: headlineHistory(runs, specOf),
      },
    ];
  });
}
