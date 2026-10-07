/**
 * The alert endpoints. Everyone signed in reads alerts and replays the versions ever active;
 * analysts mute and unmute, for at most seven days; editors mute without an end and replay any
 * spec; admins set how many alerts may be active per connector. An alert's drafts follow its
 * thread: only its owner and admins see them, activate and deactivate it, and others read it as a
 * viewer does (`../ownership.ts`).
 */
import {
  type AlertDetail,
  type AlertSummary,
  activateAlertEndpoint,
  deactivateAlertEndpoint,
  getAlertEndpoint,
  getAlertSettingsEndpoint,
  listAlertsEndpoint,
  muteAlertEndpoint,
  type Principal,
  replayAlertSpecEndpoint,
  replayAlertVersionEndpoint,
  saveAlertSettingsEndpoint,
  unmuteAlertEndpoint,
} from '@quanthea/shared';
import type { Hono } from 'hono';
import type { Alerts } from '../../alerts/alerts.ts';
import type { Users } from '../../auth/users.ts';
import type { AlertSettingsService } from '../../settings/alert-settings.ts';
import type { ThreadBin } from '../../threads/bin.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { canChangeAs, checkOwnerChange, madeBy, ownerNames, readerRole } from '../ownership.ts';
import { actorOf, signedIn } from '../principal.ts';

/** What the alert endpoints need. */
export interface AlertRouteServices {
  /** The alerts. */
  readonly alerts: Alerts;
  /** The alert settings. */
  readonly alertSettings: AlertSettingsService;
  /** The users, for names. */
  readonly users: Pick<Users, 'nameOf'>;
  /** The bin, for the owner of an alert's thread. */
  readonly bin: Pick<ThreadBin, 'threadOwner'>;
}

/**
 * Refuses a change to an alert unless the person owns its thread or is an admin, or it has no
 * thread.
 *
 * @param services - The alerts and the bin.
 * @param principal - Who asks.
 * @param alertId - The alert.
 * @throws {AppError} `forbidden`, or `not_found` for an unknown alert.
 */
export function checkAlertChange(
  services: Pick<AlertRouteServices, 'alerts' | 'bin'>,
  principal: Principal | null,
  alertId: string,
): void {
  const owner = madeBy(services.bin.threadOwner, services.alerts.threadOf(alertId));
  checkOwnerChange(signedIn(principal), owner);
}

/**
 * Reads an alert's detail for someone, with whether they may change it.
 *
 * @param services - The alerts, the users and the bin.
 * @param principal - Who reads.
 * @param alertId - The alert.
 * @returns The detail, its people named.
 */
function detailFor(services: AlertRouteServices, principal: Principal, alertId: string) {
  const { alerts, users, bin } = services;
  const detail = alerts.get(alertId, readerRole(principal, bin.threadOwner));
  const canChange = canChangeAs(principal, madeBy(bin.threadOwner, detail.threadId));
  return nameDetail(ownerNames(users), { ...detail, canChange });
}

/**
 * Names whoever muted an alert, in place of their user id.
 *
 * @param nameOf - Looks a name up by user id.
 * @param summary - The alert.
 * @returns The alert with a name.
 */
async function nameMuter<Summary extends AlertSummary>(
  nameOf: ReturnType<typeof ownerNames>,
  summary: Summary,
): Promise<Summary> {
  if (!summary.muted) return summary;
  return { ...summary, muted: { ...summary.muted, by: await nameOf(summary.muted.by) } };
}

/**
 * Names the people of an alert's detail: whoever muted it, saved each version and changed it.
 *
 * @param nameOf - Looks a name up by user id.
 * @param detail - The alert.
 * @returns The alert with names.
 */
async function nameDetail(
  nameOf: ReturnType<typeof ownerNames>,
  detail: AlertDetail,
): Promise<AlertDetail> {
  const versions = await Promise.all(
    detail.versions.map(async (version) => ({
      ...version,
      createdBy: await nameOf(version.createdBy),
    })),
  );
  const activity = await Promise.all(
    detail.activity.map(async (change) => ({ ...change, by: await nameOf(change.by) })),
  );
  return nameMuter(nameOf, { ...detail, versions, activity });
}

/**
 * Mounts the endpoints that read alerts and replay them.
 *
 * @param app - The app.
 * @param services - The alerts and the users.
 */
function mountReadEndpoints(app: Hono<AppEnv>, services: AlertRouteServices): void {
  const { alerts, users, bin } = services;
  mountEndpoint(app, listAlertsEndpoint, {
    access: 'viewer',
    handle: async ({ principal }) => {
      const nameOf = ownerNames(users);
      const listed = alerts.list(readerRole(signedIn(principal), bin.threadOwner));
      return { alerts: await Promise.all(listed.map((each) => nameMuter(nameOf, each))) };
    },
  });
  mountEndpoint(app, getAlertEndpoint, {
    access: 'viewer',
    handle: ({ params, principal }) => detailFor(services, signedIn(principal), params.alertId),
  });
  mountEndpoint(app, replayAlertSpecEndpoint, {
    access: 'editor',
    handle: ({ body: { spec, ...window } }) => alerts.replaySpec(spec, window),
  });
  mountEndpoint(app, replayAlertVersionEndpoint, {
    access: 'viewer',
    handle: ({ params, body, principal }) => {
      const reader = readerRole(signedIn(principal), bin.threadOwner);
      return alerts.replayVersion(params.alertId, Number(params.version), body, reader);
    },
  });
}

/**
 * Mounts the endpoints that change alerts.
 *
 * @param app - The app.
 * @param services - The alerts and the users.
 */
function mountChangeEndpoints(app: Hono<AppEnv>, services: AlertRouteServices): void {
  const { alerts, users } = services;
  const named = (summary: AlertSummary) => nameMuter(ownerNames(users), summary);
  mountEndpoint(app, activateAlertEndpoint, {
    access: 'editor',
    handle: async ({ params, body, principal }) => {
      checkAlertChange(services, principal, params.alertId);
      return named(await alerts.activate(params.alertId, body.version, actorOf(principal)));
    },
  });
  mountEndpoint(app, deactivateAlertEndpoint, {
    access: 'editor',
    handle: async ({ params, principal }) => {
      checkAlertChange(services, principal, params.alertId);
      return named(await alerts.deactivate(params.alertId, actorOf(principal)));
    },
  });
  mountEndpoint(app, muteAlertEndpoint, {
    access: 'analyst',
    handle: ({ params, body, principal }) =>
      named(alerts.mute(params.alertId, body.until, signedIn(principal))),
  });
  mountEndpoint(app, unmuteAlertEndpoint, {
    access: 'analyst',
    handle: ({ params, principal }) => named(alerts.unmute(params.alertId, signedIn(principal))),
  });
}

/**
 * Mounts every alert endpoint, and the alert settings.
 *
 * @param app - The app.
 * @param services - The alerts, their settings and the users.
 */
export function mountAlertEndpoints(app: Hono<AppEnv>, services: AlertRouteServices): void {
  mountReadEndpoints(app, services);
  mountChangeEndpoints(app, services);
  const { alertSettings } = services;
  mountEndpoint(app, getAlertSettingsEndpoint, {
    access: 'admin',
    handle: () => alertSettings.get(),
  });
  mountEndpoint(app, saveAlertSettingsEndpoint, {
    access: 'admin',
    handle: ({ body, principal }) => alertSettings.save(body, actorOf(principal)),
  });
}
