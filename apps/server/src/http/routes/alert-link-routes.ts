/**
 * The endpoints of the links between alerts and dashboard panels. Every role reads where an alert
 * is shown and the alerts on a dashboard's panels, as it reads alerts and dashboards; editors
 * link, unlink, dismiss suggestions and list the panels to link to.
 */
import {
  dismissLinkEndpoint,
  getAlertLinksEndpoint,
  getDashboardAlertsEndpoint,
  linkAlertEndpoint,
  listLinkTargetsEndpoint,
  resolveTimeRange,
  unlinkAlertEndpoint,
} from '@quanthea/shared';
import type { Hono } from 'hono';
import type { PanelLinks } from '../../alerts/links.ts';
import type { ThreadBin } from '../../threads/bin.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { roleForDashboard } from '../ownership.ts';
import { actorOf, signedIn } from '../principal.ts';

/** What the link endpoints need. */
export interface AlertLinkRouteServices {
  /** The links. */
  readonly panelLinks: PanelLinks;
  /** The bin, for the thread a dashboard belongs to. */
  readonly bin: Pick<ThreadBin, 'ownerOf'>;
}

/**
 * Mounts the endpoints that change links.
 *
 * @param app - The app.
 * @param panelLinks - The links.
 */
function mountChangeEndpoints(app: Hono<AppEnv>, panelLinks: PanelLinks): void {
  mountEndpoint(app, linkAlertEndpoint, {
    access: 'editor',
    handle: ({ params, body, principal }) => {
      panelLinks.link(params.alertId, body, actorOf(principal));
      return panelLinks.forAlert(params.alertId, signedIn(principal).role);
    },
  });
  mountEndpoint(app, unlinkAlertEndpoint, {
    access: 'editor',
    handle: ({ params: { alertId, ...panel }, principal }) => {
      panelLinks.unlink(alertId, panel, actorOf(principal));
      return panelLinks.forAlert(alertId, signedIn(principal).role);
    },
  });
  mountEndpoint(app, dismissLinkEndpoint, {
    access: 'editor',
    handle: ({ params, body, principal }) => {
      panelLinks.dismiss(params.alertId, body, actorOf(principal));
      return panelLinks.forAlert(params.alertId, signedIn(principal).role);
    },
  });
}

/**
 * Mounts every link endpoint.
 *
 * @param app - The app.
 * @param services - The links and the bin.
 */
export function mountAlertLinkEndpoints(app: Hono<AppEnv>, services: AlertLinkRouteServices): void {
  const { panelLinks, bin } = services;
  mountEndpoint(app, getAlertLinksEndpoint, {
    access: 'viewer',
    handle: ({ params, principal }) =>
      panelLinks.forAlert(params.alertId, signedIn(principal).role),
  });
  mountEndpoint(app, listLinkTargetsEndpoint, {
    access: 'editor',
    handle: () => ({ dashboards: panelLinks.targets() }),
  });
  mountEndpoint(app, getDashboardAlertsEndpoint, {
    access: 'viewer',
    handle: ({ params, query, principal }) => {
      const role = roleForDashboard(signedIn(principal), bin.ownerOf(params.dashboardId));
      const range = resolveTimeRange(query, Date.now());
      return panelLinks.forDashboard(params.dashboardId, role, range);
    },
  });
  mountChangeEndpoints(app, panelLinks);
}
