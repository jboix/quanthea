/**
 * How many alerts fire, for the rail's badge. It reads the list while the list is on screen, so the
 * badge follows it, and otherwise a resource route that loads when the rail mounts and again after
 * every change made through an action.
 */
import { useEffect } from 'react';
import { type LoaderFunctionArgs, useFetcher, useRouteLoaderData } from 'react-router';
import type { ApiClient } from '../../lib/api-client.ts';
import { type AlertsData, loadAlerts } from './data.ts';
import { firingCount } from './grouping.ts';

/** The id of the list's route, whose data the badge reads while the list is on screen. */
export const alertsRouteId = 'alerts';

/** The path of the resource route that counts the firing alerts. */
export const firingPath = '/alerts/firing';

/** What the resource route answers: the count, or `null` when the list could not be read. */
interface FiringData {
  /** How many alerts fire. */
  readonly firing: number | null;
}

/**
 * Loads how many alerts fire. A failure gives no count, so the badge never breaks the screen.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadFiring(api: ApiClient) {
  const load = loadAlerts(api);
  return async (args: LoaderFunctionArgs): Promise<FiringData> => {
    try {
      return { firing: firingCount((await load(args)).alerts) };
    } catch {
      return { firing: null };
    }
  };
}

/**
 * How many alerts fire now.
 *
 * @returns The count, or `undefined` until it is known.
 */
export function useFiringAlerts(): number | undefined {
  const listed = useRouteLoaderData(alertsRouteId) as AlertsData | undefined;
  const { load, data, state } = useFetcher<FiringData>({ key: 'alerts-firing' });
  const missing = state === 'idle' && data === undefined;
  useEffect(() => {
    if (missing) void load(firingPath);
  }, [missing, load]);
  if (listed) return firingCount(listed.alerts);
  return data?.firing ?? undefined;
}
