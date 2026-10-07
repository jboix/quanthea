/**
 * The changes people make to reports: save a version, activate one, deactivate. Versions are never
 * rewritten. Activating checks the spec again and runs its queries once over its latest period, so
 * a version whose queries fail never goes on the schedule.
 */
import { nextRunAt, type ReportSpec } from '@quanthea/shared';
import { refuseSpec } from '../dashboards/context.ts';
import { AppError } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { type ReportsContext, reportOrThrow } from './context.ts';
import { type Execution, executeReport } from './execute.ts';
import { periodsAt } from './runs.ts';
import { type ReportValidationContext, validateReportSpec } from './validate.ts';

/** A new version to save. */
export interface NewReportVersionInput {
  /** The report; a new report when left out. */
  readonly reportId?: string | undefined;
  /** The spec, as JSON. */
  readonly spec: unknown;
  /** What changed, in words. */
  readonly note?: string | null | undefined;
  /** The conversation that made it, for a new report. */
  readonly threadId?: string | null | undefined;
}

/** A spec checked and run once over its latest period. */
export interface ReportCheck {
  /** The valid spec. */
  readonly spec: ReportSpec;
  /** The period and the comparison period it ran over. */
  readonly periods: ReturnType<typeof periodsAt>;
  /** Its results, and why it failed, if it did. */
  readonly execution: Execution;
}

/**
 * What validation needs: the connectors, the clock, the channels and the pinned dashboards.
 *
 * @param context - The service context.
 * @returns The validation context.
 */
function validationOf(context: ReportsContext): ReportValidationContext {
  return {
    lookup: context.lookup,
    now: context.now(),
    channelExists: context.channelExists,
    dashboardPinned: (id) => Boolean(context.dashboard(id)?.pinnedVersionId),
  };
}

/**
 * Validates a spec, refusing it with its issues.
 *
 * @param context - The service context.
 * @param input - The spec, as JSON.
 * @returns The valid spec.
 * @throws {AppError} `bad_request` with the issues.
 */
export function validReport(context: ReportsContext, input: unknown): ReportSpec {
  const validation = validateReportSpec(input, validationOf(context));
  if (!validation.ok) refuseSpec('The report spec is invalid.', validation.issues);
  return validation.spec;
}

/**
 * Validates a spec and runs it once over its latest period, storing nothing.
 *
 * @param context - The service context.
 * @param input - The spec, as JSON.
 * @returns The spec, the periods and the results.
 * @throws {AppError} `bad_request` with the issues of an invalid spec.
 */
export async function checkReport(context: ReportsContext, input: unknown): Promise<ReportCheck> {
  const spec = validReport(context, input);
  const periods = periodsAt(spec, context.now());
  const runner = { openSource: context.openSource, executor: context.executor, now: context.now };
  const execution = await executeReport(runner, spec, periods.period, periods.comparison);
  return { spec, periods, execution };
}

/**
 * Saves a new version from a spec. The spec is validated; its queries are not run.
 *
 * @param context - The service context.
 * @param input - The report, the spec, a note and the thread.
 * @param actor - Who saves.
 * @returns The report and the version number.
 * @throws {AppError} `bad_request` with the spec's issues, `not_found` for an unknown report.
 */
export function saveVersion(
  context: ReportsContext,
  input: NewReportVersionInput,
  actor: string,
): { reportId: string; version: number } {
  if (input.reportId !== undefined) reportOrThrow(context, input.reportId);
  const spec = validReport(context, input.spec);
  const reportId = input.reportId ?? newId();
  const row = { reportId, title: spec.title, spec, note: input.note ?? null, createdBy: actor };
  const version = context.repository.addVersion(
    { ...row, createdAt: context.now() },
    input.threadId,
  );
  context.audit.append({ actor, action: 'report.version', target: reportId, detail: { version } });
  return { reportId, version };
}

/**
 * Refuses an activation while the thread that made the report is in the bin: purging it would
 * leave an active report without its thread.
 *
 * @param binned - Whether the thread is in the bin.
 * @throws {AppError} `bad_request` when it is.
 */
function checkOutsideBin(binned: boolean): void {
  if (binned)
    throw new AppError('bad_request', 'Its thread is in the bin. Restore it before activating.');
}

/**
 * Activates a version: checks it again, runs its queries once over its latest period, and puts it
 * on the schedule.
 *
 * @param context - The service context.
 * @param id - The report.
 * @param version - The version.
 * @param actor - Who activates.
 * @throws {AppError} `not_found`, or `bad_request` with the issues, the failing query, or while
 *   its thread is in the bin.
 */
export async function activate(
  context: ReportsContext,
  id: string,
  version: number,
  actor: string,
): Promise<void> {
  reportOrThrow(context, id);
  checkOutsideBin(context.repository.threadBinned(id));
  const row = context.repository.version(id, version);
  if (!row) throw new AppError('not_found', `Report ${id} has no version ${version}.`);
  const { spec, execution } = await checkReport(context, row.spec);
  if (execution.failure !== null)
    refuseSpec('This version cannot be activated.', [
      { path: 'panels', message: execution.failure },
    ]);
  const now = context.now();
  // The thread may have gone to the bin while the queries ran.
  const outcome = context.repository.activate(id, version, now, nextRunAt(spec.schedule, now));
  checkOutsideBin(outcome === 'binned');
  context.audit.append({ actor, action: 'report.activate', target: id, detail: { version } });
}

/**
 * Stops a report's schedule. Its active version and its runs stay.
 *
 * @param context - The service context.
 * @param id - The report.
 * @param actor - Who deactivates.
 * @throws {AppError} `not_found`.
 */
export function deactivate(context: ReportsContext, id: string, actor: string): void {
  reportOrThrow(context, id);
  context.repository.deactivate(id, context.now());
  context.audit.append({ actor, action: 'report.deactivate', target: id });
}
