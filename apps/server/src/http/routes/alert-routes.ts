/**
 * The alert endpoints. Everyone signed in reads alerts; analysts mute and unmute, for at most
 * seven days; editors activate, deactivate, mute without an end and replay; admins set how many
 * alerts may be active per connector.
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
  replayAlertSpecEndpoint,
  replayAlertVersionEndpoint,
  saveAlertSettingsEndpoint,
  unmuteAlertEndpoint,
} from '@quanthea/shared';
import type { Hono } from 'hono';
import type { Alerts } from '../../alerts/alerts.ts';
import type { Users } from '../../auth/users.ts';
import type { AlertSettingsService } from '../../settings/alert-settings.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { ownerNames } from '../ownership.ts';
import { actorOf, signedIn } from '../principal.ts';

/** What the alert endpoints need. */
export interface AlertRouteServices {
  /** The alerts. */
  readonly alerts: Alerts;
  /** The alert settings. */
  readonly alertSettings: AlertSettingsService;
  /** The users, for names. */
  readonly users: Pick<Users, 'nameOf'>;
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
 * Names the people of an alert's detail: whoever muted it and saved each version.
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
  return nameMuter(nameOf, { ...detail, versions });
}

/**
 * Mounts the endpoints that read alerts and replay them.
 *
 * @param app - The app.
 * @param services - The alerts and the users.
 */
function mountReadEndpoints(app: Hono<AppEnv>, services: AlertRouteServices): void {
  const { alerts, users } = services;
  mountEndpoint(app, listAlertsEndpoint, {
    access: 'viewer',
    handle: async ({ principal }) => {
      const nameOf = ownerNames(users);
      const listed = alerts.list(signedIn(principal).role);
      return { alerts: await Promise.all(listed.map((each) => nameMuter(nameOf, each))) };
    },
  });
  mountEndpoint(app, getAlertEndpoint, {
    access: 'viewer',
    handle: ({ params, principal }) =>
      nameDetail(ownerNames(users), alerts.get(params.alertId, signedIn(principal).role)),
  });
  mountEndpoint(app, replayAlertSpecEndpoint, {
    access: 'editor',
    handle: ({ body: { spec, ...window } }) => alerts.replaySpec(spec, window),
  });
  mountEndpoint(app, replayAlertVersionEndpoint, {
    access: 'editor',
    handle: ({ params, body }) =>
      alerts.replayVersion(params.alertId, Number(params.version), body),
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
    handle: async ({ params, body, principal }) =>
      named(await alerts.activate(params.alertId, body.version, actorOf(principal))),
  });
  mountEndpoint(app, deactivateAlertEndpoint, {
    access: 'editor',
    handle: ({ params, principal }) => named(alerts.deactivate(params.alertId, actorOf(principal))),
  });
  mountEndpoint(app, muteAlertEndpoint, {
    access: 'analyst',
    handle: ({ params, body, principal }) =>
      named(alerts.mute(params.alertId, body.until, signedIn(principal))),
  });
  mountEndpoint(app, unmuteAlertEndpoint, {
    access: 'analyst',
    handle: ({ params, principal }) => named(alerts.unmute(params.alertId, actorOf(principal))),
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
