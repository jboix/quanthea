/** The routes of the alerts: the list, an alert's page, and their resource routes. */
import type { RouteObject } from 'react-router';
import { guarded } from '../app/route-access.ts';
import type { SessionLoader } from '../app/session.ts';
import {
  alertsRouteId,
  changeAlert,
  firingPath,
  loadAlert,
  loadAlertLinks,
  loadAlertReplay,
  loadAlerts,
  loadFiring,
  loadLinkTargets,
} from '../features/alerts/index.ts';
import type { ApiClient } from '../lib/api-client.ts';

/**
 * The alerts routes, for every role. The API refuses what a role may not change.
 *
 * @param loadSession - Loads the current session.
 * @param api - The API client.
 * @returns The route objects.
 */
export function alertRoutes(loadSession: SessionLoader, api: ApiClient): RouteObject[] {
  const screens = async () => import('../features/alerts/screens.ts');
  const replay = '/alerts/:alertId/v/:version/replay';
  const links = '/alerts/:alertId/links';
  const targets = '/alert-link-targets';
  return [
    {
      id: alertsRouteId,
      path: '/alerts',
      loader: guarded(loadSession, '/alerts', loadAlerts(api)),
      lazy: { Component: async () => (await screens()).AlertsScreen },
    },
    // Counts the firing alerts for the rail; loads again after every action.
    { path: firingPath, loader: guarded(loadSession, firingPath, loadFiring(api)) },
    {
      path: '/alerts/:alertId',
      loader: guarded(loadSession, '/alerts/:alertId', loadAlert(api)),
      action: guarded(loadSession, '/alerts/:alertId', changeAlert(api)),
      lazy: { Component: async () => (await screens()).AlertScreen },
    },
    // The chart's replay loads when the page opens or the window changes, not after a change.
    {
      path: replay,
      loader: guarded(loadSession, replay, loadAlertReplay(api)),
      shouldRevalidate: () => false,
    },
    // Where an alert is shown, for the agent's card; again after every action.
    { path: links, loader: guarded(loadSession, links, loadAlertLinks(api)) },
    // The pinned dashboards' panels, when Link to a panel… opens.
    {
      path: targets,
      loader: guarded(loadSession, targets, loadLinkTargets(api)),
      shouldRevalidate: () => false,
    },
  ];
}
