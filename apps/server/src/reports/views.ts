/**
 * Turns stored reports and runs into what the API returns. People are named by user id here; the
 * routes replace the ids with names. Below editor, a report shows once a version is active, with
 * the versions ever active and their runs only.
 */
import {
  hasRole,
  headlineSchema,
  type PeriodRange,
  periodLabel,
  type ReportDetail,
  type ReportRunSummary,
  type ReportSpec,
  type ReportSummary,
  type Role,
  reportSpecSchema,
} from '@quanthea/shared';
import { z } from 'zod';
import type { ReportRow, ReportVersionRow } from '../db/report-repository.ts';
import type { RunSummaryRow } from '../db/report-run-repository.ts';
import { AppError } from '../lib/errors.ts';
import { type ReportsContext, reportOrThrow } from './context.ts';

/** Reads stored headline numbers. */
const headlinesSchema = z.array(headlineSchema);

/** A report's versions with their parsed specs, by number. */
export type VersionSpecs = ReadonlyMap<number, { row: ReportVersionRow; spec: ReportSpec }>;

/**
 * Whether a role may see a report: editors see every report, others those with an active version.
 *
 * @param report - The report.
 * @param role - The role.
 * @returns `true` when the role may see it.
 */
function canSeeReport(report: ReportRow, role: Role): boolean {
  return hasRole(role, 'editor') || report.activeVersion !== null;
}

/**
 * Reads a report the role may see.
 *
 * @param context - The service context.
 * @param id - The report.
 * @param role - The role.
 * @returns The report.
 * @throws {AppError} `not_found`, also for a report never activated below editor.
 */
export function visibleReport(context: ReportsContext, id: string, role: Role): ReportRow {
  const report = reportOrThrow(context, id);
  if (!canSeeReport(report, role)) throw new AppError('not_found', `No report ${id}.`);
  return report;
}

/**
 * A report's versions with their specs.
 *
 * @param context - The service context.
 * @param id - The report.
 * @returns The versions, by number.
 */
export function versionSpecs(context: ReportsContext, id: string): VersionSpecs {
  return new Map(
    context.repository
      .versions(id)
      .map((row) => [row.version, { row, spec: reportSpecSchema.parse(row.spec) }] as const),
  );
}

/**
 * The versions whose runs a role may see.
 *
 * @param versions - The report's versions.
 * @param role - The role.
 * @returns The version numbers, or `null` for every one (editors).
 */
export function visibleVersions(versions: VersionSpecs, role: Role): number[] | null {
  if (hasRole(role, 'editor')) return null;
  return [...versions.values()]
    .filter(({ row }) => row.activatedAt !== null)
    .map(({ row }) => row.version);
}

/**
 * A period with its name.
 *
 * @param spec - The spec of the run's version.
 * @param period - The period.
 * @returns The period and its name.
 */
function periodView(spec: ReportSpec, period: PeriodRange) {
  return { ...period, label: periodLabel(spec.period, period, spec.schedule.timezone) };
}

/**
 * A run without its results.
 *
 * @param run - The stored run.
 * @param spec - The spec of its version.
 * @returns The summary, naming who ran it by user id.
 */
export function toRunSummary(run: RunSummaryRow, spec: ReportSpec): ReportRunSummary {
  const headlines = headlinesSchema.safeParse(run.headlines);
  return {
    id: run.id,
    reportId: run.reportId,
    version: run.version,
    trigger: run.kind,
    status: run.status,
    attempts: run.attempts,
    retryAt: run.retryAt,
    error: run.error,
    period: periodView(spec, run.period),
    comparison: run.comparison === null ? null : periodView(spec, run.comparison),
    headlines: headlines.success ? headlines.data : [],
    startedBy: run.startedBy,
    createdAt: run.createdAt,
    ranAt: run.ranAt,
    sentAt: run.sentAt,
  };
}

/**
 * A report without its versions.
 *
 * @param report - The report.
 * @param versions - Its versions.
 * @param role - The role of the reader: the latest version, a draft maybe, shows to editors only.
 * @param lastRun - Its latest run the role may see, if any.
 * @returns The summary.
 */
export function toReportSummary(
  report: ReportRow,
  versions: VersionSpecs,
  role: Role,
  lastRun: RunSummaryRow | undefined,
): ReportSummary {
  const shown = versions.get(report.activeVersion ?? report.latestVersion);
  if (!shown) throw new AppError('not_found', `No report ${report.id}.`);
  const runSpec = lastRun ? versions.get(lastRun.version)?.spec : undefined;
  const active = report.activeVersion !== null && report.deactivatedAt === null;
  return {
    id: report.id,
    title: report.title,
    activeVersion: report.activeVersion,
    latestVersion: hasRole(role, 'editor') ? report.latestVersion : null,
    deactivated: report.deactivatedAt !== null,
    schedule: shown.spec.schedule,
    period: shown.spec.period,
    nextRunAt: active ? report.nextRunAt : null,
    lastRun: lastRun && runSpec ? toRunSummary(lastRun, runSpec) : null,
    threadId: report.threadId,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
  };
}

/**
 * A report with the versions the role may see.
 *
 * @param summary - Its summary.
 * @param versions - Its versions.
 * @param role - The role.
 * @returns The detail, naming who saved each version by user id.
 */
export function toReportDetail(
  summary: ReportSummary,
  versions: VersionSpecs,
  role: Role,
): ReportDetail {
  const shown = [...versions.values()]
    .filter(({ row }) => hasRole(role, 'editor') || row.activatedAt !== null)
    .map(({ row, spec }) => ({
      version: row.version,
      spec,
      note: row.note,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      activatedAt: row.activatedAt,
    }));
  return { ...summary, versions: shown };
}

/**
 * Lists the reports a role may see.
 *
 * @param context - The service context.
 * @param role - The role.
 * @returns The summaries, the newest report first.
 */
export function listReports(context: ReportsContext, role: Role): ReportSummary[] {
  return context.repository
    .list()
    .filter((report) => canSeeReport(report, role))
    .map((report) => {
      const versions = versionSpecs(context, report.id);
      const options = { versions: visibleVersions(versions, role), limit: 1 };
      const [last] = context.runs.list(report.id, options);
      return toReportSummary(report, versions, role, last);
    });
}
