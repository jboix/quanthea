/**
 * The alerts on a dashboard's panels, and what a panel's info bubble does about them: start an
 * alert conversation from the panel, link a suggested alert, or dismiss the suggestion. The
 * alerts load through a resource route, again after every action, so a new link shows at once.
 */
import {
  createThreadEndpoint,
  type DashboardAlerts,
  dismissLinkEndpoint,
  getDashboardAlertsEndpoint,
  linkAlertEndpoint,
  type TimeRangeExpression,
} from '@quanthea/shared';
import { useEffect } from 'react';
import { type LoaderFunctionArgs, redirect, useFetcher } from 'react-router';
import type { ApiClient } from '../../lib/api-client.ts';
import { type Loaded, loaded } from './loaded.ts';

/** What a panel's info bubble submits about alerts, as JSON. */
export type AlertIntent =
  | { readonly intent: 'alertFromPanel'; readonly version: number; readonly panelId: string }
  | { readonly intent: 'linkAlert'; readonly alertId: string; readonly panelId: string }
  | { readonly intent: 'dismissAlert'; readonly alertId: string; readonly panelId: string };

/**
 * The address of a dashboard's alerts over a range.
 *
 * @param dashboardId - The dashboard.
 * @param time - The range shown, or `undefined` for the spec's.
 * @param fallback - The spec's range.
 * @returns The resource route's address.
 */
export function dashboardAlertsPath(
  dashboardId: string,
  time: TimeRangeExpression | undefined,
  fallback: TimeRangeExpression,
): string {
  const range = time ?? fallback;
  return `/d/${dashboardId}/alerts?${new URLSearchParams({ from: range.from, to: range.to })}`;
}

/**
 * The loader of a dashboard's alerts resource route.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadDashboardAlerts(api: ApiClient) {
  return ({ params, request }: LoaderFunctionArgs): Promise<Loaded<DashboardAlerts>> => {
    const search = new URL(request.url).searchParams;
    const query = { from: search.get('from') ?? undefined, to: search.get('to') ?? undefined };
    const input = { params: { dashboardId: params.dashboardId ?? '' }, query };
    return loaded(api.call(getDashboardAlertsEndpoint, input, { signal: request.signal }));
  };
}

/**
 * The key of the fetcher that holds a dashboard's alerts, so the panels and the About tab share it.
 *
 * @param dashboardId - The dashboard.
 * @returns The key.
 */
export function alertsFetcherKey(dashboardId: string): string {
  return `dashboard-alerts-${dashboardId}`;
}

/**
 * The alerts on a dashboard's panels, once some part of the screen loaded them.
 *
 * @param dashboardId - The dashboard.
 * @returns The alerts, if they loaded.
 */
export function useDashboardAlertsData(dashboardId: string): DashboardAlerts | undefined {
  const { data } = useFetcher<Loaded<DashboardAlerts>>({ key: alertsFetcherKey(dashboardId) });
  return data?.ok ? data.value : undefined;
}

/**
 * Loads the alerts on a dashboard's panels whenever the address changes.
 *
 * @param dashboardId - The dashboard.
 * @param path - The resource route's address, or `undefined` to load nothing.
 * @returns The alerts, once loaded.
 */
export function useDashboardAlerts(
  dashboardId: string,
  path: string | undefined,
): DashboardAlerts | undefined {
  const fetcher = useFetcher<Loaded<DashboardAlerts>>({ key: alertsFetcherKey(dashboardId) });
  const { load, data } = fetcher;
  useEffect(() => {
    if (path !== undefined) void load(path);
  }, [load, path]);
  return path !== undefined && data?.ok ? data.value : undefined;
}

/**
 * Runs what a panel's info bubble asks about alerts: start an alert conversation from the panel
 * and go to it, link a suggested alert, or dismiss the suggestion.
 *
 * @param api - The API client.
 * @param dashboardId - The dashboard.
 * @param intent - What to do.
 * @returns The redirect to the new conversation, or the outcome.
 */
export async function runAlertIntent(
  api: ApiClient,
  dashboardId: string,
  intent: AlertIntent,
): Promise<Response | Loaded<unknown>> {
  if (intent.intent === 'alertFromPanel') {
    const seed = { dashboardId, version: intent.version, panelId: intent.panelId };
    const body = { kind: 'alert' as const, seed };
    const outcome = await loaded(api.call(createThreadEndpoint, { body }));
    return outcome.ok ? redirect(`/threads/${outcome.value.id}`) : outcome;
  }
  const params = { alertId: intent.alertId };
  const panel = { dashboardId, panelId: intent.panelId };
  if (intent.intent === 'linkAlert')
    return loaded(api.call(linkAlertEndpoint, { params, body: { ...panel, how: 'query_match' } }));
  return loaded(api.call(dismissLinkEndpoint, { params, body: panel }));
}
