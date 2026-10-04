/**
 * The report endpoints. Everyone signed in reads reports and their runs (below editor, once a
 * version is active, and the runs of versions ever active); editors activate, deactivate, run one
 * now, preview a spec and send a test; admins set the retries and how long runs are kept.
 */
import {
  activateReportEndpoint,
  deactivateReportEndpoint,
  getReportEndpoint,
  getReportRunEndpoint,
  getReportSettingsEndpoint,
  listReportRunsEndpoint,
  listReportsEndpoint,
  previewReportEndpoint,
  type ReportRunSummary,
  type ReportSummary,
  runReportNowEndpoint,
  saveReportSettingsEndpoint,
  testReportEndpoint,
} from '@quanthea/shared';
import type { Hono } from 'hono';
import type { Users } from '../../auth/users.ts';
import type { Reports } from '../../reports/reports.ts';
import type { ReportSettingsService } from '../../settings/report-settings.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { ownerNames } from '../ownership.ts';
import { actorOf, signedIn } from '../principal.ts';

/** What the report endpoints need. */
export interface ReportRouteServices {
  /** The reports. */
  readonly reports: Reports;
  /** The report settings. */
  readonly reportSettings: ReportSettingsService;
  /** The users, for names. */
  readonly users: Pick<Users, 'nameOf'>;
}

/** Looks a name up by user id. */
type NameOf = ReturnType<typeof ownerNames>;

/**
 * Names whoever ran a run by hand, in place of their user id.
 *
 * @param nameOf - Looks a name up by user id.
 * @param run - The run.
 * @returns The run with a name.
 */
async function nameRun<Run extends ReportRunSummary>(nameOf: NameOf, run: Run): Promise<Run> {
  return run.startedBy === null ? run : { ...run, startedBy: await nameOf(run.startedBy) };
}

/**
 * Names whoever ran a report's latest run.
 *
 * @param nameOf - Looks a name up by user id.
 * @param summary - The report.
 * @returns The report with a name.
 */
async function nameSummary<Summary extends ReportSummary>(
  nameOf: NameOf,
  summary: Summary,
): Promise<Summary> {
  return summary.lastRun
    ? { ...summary, lastRun: await nameRun(nameOf, summary.lastRun) }
    : summary;
}

/**
 * Mounts the endpoints that read reports.
 *
 * @param app - The app.
 * @param services - The reports and the users.
 */
function mountReadEndpoints(app: Hono<AppEnv>, services: ReportRouteServices): void {
  const { reports, users } = services;
  mountEndpoint(app, listReportsEndpoint, {
    access: 'viewer',
    handle: async ({ principal }) => {
      const nameOf = ownerNames(users);
      const listed = reports.list(signedIn(principal).role);
      return { reports: await Promise.all(listed.map((each) => nameSummary(nameOf, each))) };
    },
  });
  mountEndpoint(app, getReportEndpoint, {
    access: 'viewer',
    handle: async ({ params, principal }) => {
      const nameOf = ownerNames(users);
      const detail = reports.get(params.reportId, signedIn(principal).role);
      const versions = await Promise.all(
        detail.versions.map(async (each) => ({ ...each, createdBy: await nameOf(each.createdBy) })),
      );
      return nameSummary(nameOf, { ...detail, versions });
    },
  });
}

/**
 * Mounts the endpoints that read a report's runs.
 *
 * @param app - The app.
 * @param services - The reports and the users.
 */
function mountRunEndpoints(app: Hono<AppEnv>, services: ReportRouteServices): void {
  const { reports, users } = services;
  mountEndpoint(app, listReportRunsEndpoint, {
    access: 'viewer',
    handle: async ({ params, query, principal }) => {
      const nameOf = ownerNames(users);
      const runs = reports.runs(params.reportId, signedIn(principal).role, query);
      return { runs: await Promise.all(runs.map((run) => nameRun(nameOf, run))) };
    },
  });
  mountEndpoint(app, getReportRunEndpoint, {
    access: 'viewer',
    handle: ({ params, principal }) =>
      nameRun(
        ownerNames(users),
        reports.run(params.reportId, params.runId, signedIn(principal).role),
      ),
  });
}

/**
 * Mounts the endpoints that activate and deactivate reports.
 *
 * @param app - The app.
 * @param services - The reports and the users.
 */
function mountChangeEndpoints(app: Hono<AppEnv>, services: ReportRouteServices): void {
  const { reports, users } = services;
  mountEndpoint(app, activateReportEndpoint, {
    access: 'editor',
    handle: async ({ params, body, principal }) =>
      nameSummary(
        ownerNames(users),
        await reports.activate(params.reportId, body.version, actorOf(principal)),
      ),
  });
  mountEndpoint(app, deactivateReportEndpoint, {
    access: 'editor',
    handle: ({ params, principal }) =>
      nameSummary(ownerNames(users), reports.deactivate(params.reportId, actorOf(principal))),
  });
}

/**
 * Mounts the endpoints that run a report now, preview a spec and send a test.
 *
 * @param app - The app.
 * @param services - The reports and the users.
 */
function mountTryEndpoints(app: Hono<AppEnv>, services: ReportRouteServices): void {
  const { reports, users } = services;
  mountEndpoint(app, runReportNowEndpoint, {
    access: 'editor',
    handle: async ({ params, body, principal }) =>
      nameRun(
        ownerNames(users),
        await reports.runNow(params.reportId, body.send, actorOf(principal)),
      ),
  });
  mountEndpoint(app, previewReportEndpoint, {
    access: 'editor',
    handle: ({ body }) => reports.preview(body.spec),
  });
  mountEndpoint(app, testReportEndpoint, {
    access: 'editor',
    handle: async ({ params, principal }) => ({
      results: await reports.sendTest(params.reportId, Number(params.version), actorOf(principal)),
    }),
  });
}

/**
 * Mounts every report endpoint, and the report settings.
 *
 * @param app - The app.
 * @param services - The reports, their settings and the users.
 */
export function mountReportEndpoints(app: Hono<AppEnv>, services: ReportRouteServices): void {
  mountReadEndpoints(app, services);
  mountRunEndpoints(app, services);
  mountChangeEndpoints(app, services);
  mountTryEndpoints(app, services);
  const { reportSettings } = services;
  mountEndpoint(app, getReportSettingsEndpoint, {
    access: 'admin',
    handle: () => reportSettings.get(),
  });
  mountEndpoint(app, saveReportSettingsEndpoint, {
    access: 'admin',
    handle: ({ body, principal }) => reportSettings.save(body, actorOf(principal)),
  });
}
