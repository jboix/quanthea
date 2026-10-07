/**
 * Reading runs: a report's runs by period, and one run with its frozen results and the runs of
 * the periods either side. Reading runs no query. Below editor, only the runs of versions ever
 * active show.
 */
import {
  panelRunSchema,
  type ReportRunDetail,
  type ReportRunSummary,
  sendResultSchema,
  variableValuesSchema,
} from '@quanthea/shared';
import { z } from 'zod';
import type { RunSummaryRow } from '../db/report-run-repository.ts';
import { AppError } from '../lib/errors.ts';
import type { ReaderRole } from '../lib/reader-role.ts';
import type { ReportsContext } from './context.ts';
import { seeAlsoLinks } from './messages.ts';
import {
  toRunSummary,
  type VersionSpecs,
  versionSpecs,
  visibleReport,
  visibleVersions,
} from './views.ts';

/** Reads stored panel runs. */
const panelRunsSchema = z.record(z.string(), panelRunSchema).nullable();

/** How a list of runs is narrowed. */
export interface RunPage {
  /** Only runs whose period starts before this instant. */
  readonly before?: number | undefined;
  /** At most this many. */
  readonly limit: number;
}

/**
 * A neighbouring run, by period.
 *
 * @param versions - The report's versions.
 * @param run - The run, if any.
 * @returns Its id and period, or `null`.
 */
function neighbourOf(versions: VersionSpecs, run: RunSummaryRow | undefined) {
  const spec = run ? versions.get(run.version)?.spec : undefined;
  if (!run || !spec) return null;
  return { id: run.id, period: toRunSummary(run, spec).period };
}

/**
 * Lists a report's runs the role may see, the latest period first.
 *
 * @param context - The service context.
 * @param id - The report.
 * @param reader - The role, or how to find it from the report's thread.
 * @param page - Where the page starts, and its size.
 * @returns The runs, naming who ran each by user id.
 */
export function listRuns(
  context: ReportsContext,
  id: string,
  reader: ReaderRole,
  page: RunPage,
): ReportRunSummary[] {
  const role = visibleReport(context, id, reader);
  const versions = versionSpecs(context, id);
  const options = { versions: visibleVersions(versions, role), ...page };
  return context.runs.list(id, options).flatMap((run) => {
    const spec = versions.get(run.version)?.spec;
    return spec ? [toRunSummary(run, spec)] : [];
  });
}

/**
 * Reads one run with its frozen results.
 *
 * @param context - The service context.
 * @param id - The report.
 * @param runId - The run.
 * @param reader - The role, or how to find it from the report's thread.
 * @returns The run, naming who ran it by user id.
 * @throws {AppError} `not_found` for a run the role may not see.
 */
export function readRun(
  context: ReportsContext,
  id: string,
  runId: string,
  reader: ReaderRole,
): ReportRunDetail {
  const role = visibleReport(context, id, reader);
  const versions = versionSpecs(context, id);
  const allowed = visibleVersions(versions, role);
  const run = context.runs.get(runId);
  const spec = run ? versions.get(run.version)?.spec : undefined;
  if (!run || !spec || run.reportId !== id || (allowed && !allowed.includes(run.version)))
    throw new AppError('not_found', `Report ${id} has no run ${runId}.`);
  const sides = context.runs.neighbours(id, run.period.from, allowed);
  const delivery = z.array(sendResultSchema).nullable().safeParse(run.delivery);
  return {
    ...toRunSummary(run, spec),
    spec,
    variables: variableValuesSchema.parse(run.variables),
    panels: panelRunsSchema.parse(run.panels),
    comparisonPanels: panelRunsSchema.parse(run.comparisonPanels),
    seeAlso: seeAlsoLinks(context, spec, run.period),
    previous: neighbourOf(versions, sides.previous),
    next: neighbourOf(versions, sides.next),
    delivery: delivery.success ? delivery.data : null,
  };
}
