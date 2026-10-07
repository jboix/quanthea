/**
 * The report endpoints. Everyone signed in reads reports and their runs (below editor, once a
 * version is active, and the runs of versions ever active); opening a run marks it seen for the
 * reader. Editors preview a spec; admins set the retries and how long runs are kept. A report's
 * drafts follow its thread: only its owner and admins see them, activate, deactivate, run it now
 * and send a test, and others read it as a viewer does (`../ownership.ts`).
 */
import {
  activateReportEndpoint,
  deactivateReportEndpoint,
  getReportEndpoint,
  getReportRunEndpoint,
  getReportSettingsEndpoint,
  listReportRunsEndpoint,
  listReportsEndpoint,
  type Principal,
  previewReportEndpoint,
  type ReportRunDetail,
  type ReportRunSummary,
  type ReportSummary,
  runReportNowEndpoint,
  saveReportSettingsEndpoint,
  testReportEndpoint,
} from '@quanthea/shared';
import type { Hono } from 'hono';
import type { Users } from '../../auth/users.ts';
import type { Notifications } from '../../notifications/notifications.ts';
import type { Reports } from '../../reports/reports.ts';
import type { ReportSettingsService } from '../../settings/report-settings.ts';
import type { ThreadBin } from '../../threads/bin.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { canChangeAs, checkOwnerChange, madeBy, ownerNames, readerRole } from '../ownership.ts';
import { actorOf, signedIn } from '../principal.ts';

/** What the report endpoints need. */
export interface ReportRouteServices {
  /** The reports. */
  readonly reports: Reports;
  /** The report settings. */
  readonly reportSettings: ReportSettingsService;
  /** The users, for names. */
  readonly users: Pick<Users, 'nameOf'>;
  /** The notification channels, for the names of those a run went to. */
  readonly notifications: Pick<Notifications, 'picker'>;
  /** The bin, for the owner of a report's thread. */
  readonly bin: Pick<ThreadBin, 'threadOwner'>;
}

/**
 * Refuses a change to a report unless the person owns its thread or is an admin, or it has no
 * thread.
 *
 * @param services - The reports and the bin.
 * @param principal - Who asks.
 * @param reportId - The report.
 * @throws {AppError} `forbidden`, or `not_found` for an unknown report.
 */
function checkReportChange(
  services: ReportRouteServices,
  principal: Principal | null,
  reportId: string,
): void {
  const owner = madeBy(services.bin.threadOwner, services.reports.threadOf(reportId));
  checkOwnerChange(signedIn(principal), owner);
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
 * Names the channels a run's message went to, those that still exist.
 *
 * @param notifications - The notification channels.
 * @param run - The run.
 * @returns The run with its channels named.
 */
function withChannelNames(
  notifications: Pick<Notifications, 'picker'>,
  run: ReportRunDetail,
): ReportRunDetail {
  if (run.delivery === null) return run;
  const names = new Map(notifications.picker().map((channel) => [channel.id, channel.name]));
  const delivery = run.delivery.map((sent) => {
    const channelName = names.get(sent.channelId);
    return channelName === undefined ? sent : { ...sent, channelName };
  });
  return { ...run, delivery };
}

/**
 * Mounts the endpoints that read reports.
 *
 * @param app - The app.
 * @param services - The reports and the users.
 */
function mountReadEndpoints(app: Hono<AppEnv>, services: ReportRouteServices): void {
  const { reports, users, bin } = services;
  mountEndpoint(app, listReportsEndpoint, {
    access: 'viewer',
    handle: async ({ principal }) => {
      const nameOf = ownerNames(users);
      const reader = signedIn(principal);
      const listed = reports.list(readerRole(reader, bin.threadOwner), reader.id);
      return { reports: await Promise.all(listed.map((each) => nameSummary(nameOf, each))) };
    },
  });
  mountEndpoint(app, getReportEndpoint, {
    access: 'viewer',
    handle: async ({ params, principal }) => {
      const nameOf = ownerNames(users);
      const reader = signedIn(principal);
      const detail = reports.get(params.reportId, readerRole(reader, bin.threadOwner));
      const versions = await Promise.all(
        detail.versions.map(async (each) => ({ ...each, createdBy: await nameOf(each.createdBy) })),
      );
      const canChange = canChangeAs(reader, madeBy(bin.threadOwner, detail.threadId));
      return nameSummary(nameOf, { ...detail, versions, canChange });
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
  const { reports, users, bin } = services;
  mountEndpoint(app, listReportRunsEndpoint, {
    access: 'viewer',
    handle: async ({ params, query, principal }) => {
      const nameOf = ownerNames(users);
      const reader = readerRole(signedIn(principal), bin.threadOwner);
      const runs = reports.runs(params.reportId, reader, query);
      return { runs: await Promise.all(runs.map((run) => nameRun(nameOf, run))) };
    },
  });
  mountEndpoint(app, getReportRunEndpoint, {
    access: 'viewer',
    handle: ({ params, principal }) => {
      const reader = signedIn(principal);
      const run = reports.run(params.reportId, params.runId, readerRole(reader, bin.threadOwner));
      reports.see(params.reportId, params.runId, reader.id);
      return nameRun(ownerNames(users), withChannelNames(services.notifications, run));
    },
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
    handle: async ({ params, body, principal }) => {
      checkReportChange(services, principal, params.reportId);
      const summary = await reports.activate(params.reportId, body.version, actorOf(principal));
      return nameSummary(ownerNames(users), summary);
    },
  });
  mountEndpoint(app, deactivateReportEndpoint, {
    access: 'editor',
    handle: ({ params, principal }) => {
      checkReportChange(services, principal, params.reportId);
      return nameSummary(
        ownerNames(users),
        reports.deactivate(params.reportId, actorOf(principal)),
      );
    },
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
    handle: async ({ params, body, principal }) => {
      checkReportChange(services, principal, params.reportId);
      const run = await reports.runNow(params.reportId, body.send, actorOf(principal));
      return nameRun(ownerNames(users), run);
    },
  });
  mountEndpoint(app, previewReportEndpoint, {
    access: 'editor',
    handle: ({ body }) => reports.preview(body.spec),
  });
  mountEndpoint(app, testReportEndpoint, {
    access: 'editor',
    handle: async ({ params, principal }) => {
      checkReportChange(services, principal, params.reportId);
      const version = Number(params.version);
      return { results: await reports.sendTest(params.reportId, version, actorOf(principal)) };
    },
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
