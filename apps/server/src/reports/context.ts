/** The reports service's dependencies and the helpers its operations share. */
import type { ReportNotification, ReportSettings, SendResult } from '@quanthea/shared';
import type { ConnectorLookup } from '../dashboards/check-queries.ts';
import type { RunnerDependencies } from '../dashboards/run-panel.ts';
import type { AuditRepository } from '../db/audit-repository.ts';
import type { DashboardRow } from '../db/dashboard-repository.ts';
import type { ReportRepository, ReportRow } from '../db/report-repository.ts';
import type { ReportRunRepository } from '../db/report-run-repository.ts';
import { AppError } from '../lib/errors.ts';
import type { Logger } from '../lib/logger.ts';

/** What the reports service needs. */
export interface ReportsDependencies extends Omit<RunnerDependencies, 'now'> {
  /** Stores reports and their versions. */
  readonly repository: ReportRepository;
  /** Stores their runs. */
  readonly runs: ReportRunRepository;
  /** Records who did what. */
  readonly audit: AuditRepository;
  /** Finds a connector by name, for validation. */
  readonly lookup: ConnectorLookup;
  /** Reads a dashboard, for the links to pinned dashboards. */
  readonly dashboard: (id: string) => DashboardRow | undefined;
  /** Whether a notification channel exists, checked on save and activation. */
  readonly channelExists?: ((channelId: string) => boolean) | undefined;
  /** Sends a report's message to channels; it never throws. */
  readonly sendReport: (
    channelIds: readonly string[],
    notification: ReportNotification,
  ) => Promise<SendResult[]>;
  /** Whether a run that failed tells its channels: the global "cannot be checked" setting. */
  readonly notifyOnError: () => boolean;
  /** The report settings: retries, their delay, and how long runs are kept. */
  readonly settings: { readonly get: () => ReportSettings };
  /** quanthea's public URL, for links in messages; paths without one. */
  readonly publicUrl?: string | undefined;
  /** Where failures to deliver are reported. */
  readonly logger?: Logger | undefined;
  /** The most bytes of results one run stores; the snapshots' cap by default. */
  readonly maxBytes?: number;
  /** The clock; `Date.now` by default. */
  readonly now?: () => number;
}

/** The service's dependencies with the clock, the size cap and the links resolved. */
export type ReportsContext = ReportsDependencies & {
  /** The clock. */
  readonly now: () => number;
  /** The most bytes of results one run stores. */
  readonly maxBytes: number;
  /** quanthea's origin, without a trailing slash; empty without a public URL. */
  readonly origin: string;
  /** The runs an attempt is being made for now, in this process. */
  readonly busy: Set<string>;
};

/**
 * Reads a report.
 *
 * @param context - The service context.
 * @param id - The report.
 * @returns The report.
 * @throws {AppError} `not_found`.
 */
export function reportOrThrow(context: ReportsContext, id: string): ReportRow {
  const report = context.repository.get(id);
  if (!report) throw new AppError('not_found', `No report ${id}.`);
  return report;
}

/**
 * The path of a run's page.
 *
 * @param reportId - The report.
 * @param runId - The run.
 * @returns Such as `/reports/<id>/runs/<run>`.
 */
export function runPath(reportId: string, runId: string): string {
  return `/reports/${encodeURIComponent(reportId)}/runs/${encodeURIComponent(runId)}`;
}

/**
 * The path of a dashboard's page on a period.
 *
 * @param dashboardId - The dashboard.
 * @param period - The period, in epoch milliseconds.
 * @param period.from - Its first instant.
 * @param period.to - Its last instant.
 * @returns Such as `/d/<id>?from=…&to=…`, the times in ISO 8601.
 */
export function dashboardPath(dashboardId: string, period: { from: number; to: number }): string {
  const search = new URLSearchParams({
    from: new Date(period.from).toISOString(),
    to: new Date(period.to).toISOString(),
  });
  return `/d/${encodeURIComponent(dashboardId)}?${search.toString()}`;
}
