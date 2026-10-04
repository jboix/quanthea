/**
 * Builds the reports and their settings over an open database. They share the panels' connectors
 * and executor, send through the notification channels, and read the alerts' "notify when it
 * cannot be checked" setting for a run that fails.
 */
import type { DashboardsDependencies } from './dashboards/context.ts';
import type { AuditRepository } from './db/audit-repository.ts';
import type { openDatabase } from './db/database.ts';
import { createReportRepository } from './db/report-repository.ts';
import { createReportRunRepository } from './db/report-run-repository.ts';
import type { Notifications } from './notifications/notifications.ts';
import { createReports, type Reports } from './reports/reports.ts';
import type { AlertSettingsService } from './settings/alert-settings.ts';
import { createReportSettings, type ReportSettingsService } from './settings/report-settings.ts';
import type { SettingsStore } from './settings/settings-store.ts';

/** The database the services run on. */
type Database = ReturnType<typeof openDatabase>;

/** What the reports need from the other services. */
export interface ReportServiceDependencies
  extends Pick<DashboardsDependencies, 'lookup' | 'openSource' | 'executor' | 'repository'> {
  /** The database. */
  readonly database: Database;
  /** The settings store. */
  readonly settings: SettingsStore;
  /** The audit log. */
  readonly audit: AuditRepository;
  /** The notification channels. */
  readonly notifications: Notifications;
  /** The alert settings, whose "notify when it cannot be checked" covers failed runs too. */
  readonly alertSettings: AlertSettingsService;
  /** quanthea's public URL, for links in messages. */
  readonly publicUrl?: string | undefined;
  /** The clock; `Date.now` by default. */
  readonly now?: () => number;
}

/** The reports and their settings. */
export interface ReportServices {
  /** The reports: versions, runs, the schedule's needs. */
  readonly reports: Reports;
  /** Retries, their delay and how long runs are kept. */
  readonly reportSettings: ReportSettingsService;
}

/**
 * Creates the reports and their settings.
 *
 * @param dependencies - The database, the connectors, the channels and the settings.
 * @returns The services.
 */
export function createReportServices(dependencies: ReportServiceDependencies): ReportServices {
  const { database, notifications, alertSettings, audit } = dependencies;
  const reportSettings = createReportSettings({ store: dependencies.settings, audit });
  const reports = createReports({
    ...dependencies,
    repository: createReportRepository(database),
    runs: createReportRunRepository(database),
    dashboard: (id) => dependencies.repository.get(id),
    channelExists: (id) => notifications.picker().some((each) => each.id === id),
    sendReport: (channelIds, notification) => notifications.sendReport(channelIds, notification),
    notifyOnError: () => alertSettings.get().notifyOnError,
    settings: reportSettings,
    ...(dependencies.now ? { now: dependencies.now } : {}),
  });
  return { reports, reportSettings };
}
