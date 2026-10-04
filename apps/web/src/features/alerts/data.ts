/**
 * Loads alerts and changes them through the API: the list, one alert, its replay over a window,
 * and the alert settings. The browser never sends a query: a replay names a saved version.
 */
import {
  type AlertDetail,
  type AlertListItem,
  type AlertReplay,
  type AlertSettings,
  activateAlertEndpoint,
  deactivateAlertEndpoint,
  getAlertEndpoint,
  getAlertSettingsEndpoint,
  listAlertsEndpoint,
  muteAlertEndpoint,
  replayAlertVersionEndpoint,
  saveAlertSettingsEndpoint,
  unmuteAlertEndpoint,
} from '@quanthea/shared';
import { type ActionFunctionArgs, data, type LoaderFunctionArgs } from 'react-router';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';

/** What the alerts list shows. */
export interface AlertsData {
  /** Every alert the role sees. */
  readonly alerts: readonly AlertListItem[];
}

/** What an alert's page shows. */
export interface AlertData {
  /** The alert with its versions, series, changes, channels and sends. */
  readonly alert: AlertDetail;
}

/** What the alert page submits, as JSON. */
export type AlertIntent =
  | { readonly intent: 'mute'; readonly until: number | null }
  | { readonly intent: 'unmute' }
  | { readonly intent: 'activate'; readonly version: number }
  | { readonly intent: 'deactivate' };

/** What an intent answers. */
export type AlertOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string };

/** What a replay load answers. */
export type ReplayOutcome =
  | { readonly ok: true; readonly replay: AlertReplay }
  | { readonly ok: false; readonly message: string };

/** The windows the alert page's chart shows, by name. */
export const replayWindows = { '6h': 6 * 3_600_000, '24h': 24 * 3_600_000, '7d': 7 * 86_400_000 };

/** A window the chart shows. */
export type ReplayWindow = keyof typeof replayWindows;

/**
 * Loads the alerts the role sees.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadAlerts(api: ApiClient) {
  return async ({ request }: LoaderFunctionArgs): Promise<AlertsData> =>
    api.call(listAlertsEndpoint, undefined, { signal: request.signal });
}

/**
 * Loads one alert. An alert the role may not see is "not found".
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadAlert(api: ApiClient) {
  return async ({ params, request }: LoaderFunctionArgs): Promise<AlertData> => {
    const input = { params: { alertId: params.alertId ?? '' } };
    try {
      return { alert: await api.call(getAlertEndpoint, input, { signal: request.signal }) };
    } catch (error) {
      if (error instanceof ApiError && error.code === 'not_found')
        throw data(null, { status: 404, statusText: 'Not Found' });
      throw error;
    }
  };
}

/**
 * Runs one intent.
 *
 * @param api - The API client.
 * @param alertId - The alert.
 * @param intent - The intent.
 */
async function run(api: ApiClient, alertId: string, intent: AlertIntent): Promise<void> {
  const params = { alertId };
  if (intent.intent === 'mute')
    await api.call(muteAlertEndpoint, { params, body: { until: intent.until } });
  else if (intent.intent === 'unmute') await api.call(unmuteAlertEndpoint, { params });
  else if (intent.intent === 'activate')
    await api.call(activateAlertEndpoint, { params, body: { version: intent.version } });
  else await api.call(deactivateAlertEndpoint, { params });
}

/**
 * The action of the alert page: mute, unmute, activate a version, deactivate.
 *
 * @param api - The API client.
 * @returns The action. A refusal comes back as a message.
 */
export function changeAlert(api: ApiClient) {
  return async ({ params, request }: ActionFunctionArgs): Promise<AlertOutcome> => {
    try {
      await run(api, params.alertId ?? '', (await request.json()) as AlertIntent);
      return { ok: true };
    } catch (error) {
      if (!(error instanceof ApiError) || error.status >= 500) throw error;
      return { ok: false, message: error.message };
    }
  };
}

/**
 * Reads the window a replay asks for.
 *
 * @param value - The `window` parameter.
 * @returns The window; 24 hours for anything else.
 */
export function windowFrom(value: string | null): ReplayWindow {
  return value !== null && value in replayWindows ? (value as ReplayWindow) : '24h';
}

/**
 * Loads a version's replay over the window ending now, for the alert page's chart.
 *
 * @param api - The API client.
 * @returns The loader. A refusal or a failing source comes back as a message.
 */
export function loadAlertReplay(api: ApiClient) {
  return async ({ params, request }: LoaderFunctionArgs): Promise<ReplayOutcome> => {
    const window = windowFrom(new URL(request.url).searchParams.get('window'));
    const to = Date.now();
    const input = {
      params: { alertId: params.alertId ?? '', version: params.version ?? '' },
      body: { from: to - replayWindows[window], to },
    };
    try {
      const replay = await api.call(replayAlertVersionEndpoint, input, { signal: request.signal });
      return { ok: true, replay };
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      return { ok: false, message: error.message };
    }
  };
}

/**
 * Loads the alert settings, for admins.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadAlertSettings(api: ApiClient) {
  return async ({ request }: LoaderFunctionArgs): Promise<AlertSettings> =>
    api.call(getAlertSettingsEndpoint, undefined, { signal: request.signal });
}

/**
 * Saves the alert settings.
 *
 * @param api - The API client.
 * @returns The action. A refusal comes back as a message.
 */
export function saveAlertSettings(api: ApiClient) {
  return async ({ request }: ActionFunctionArgs): Promise<AlertOutcome> => {
    try {
      const body = (await request.json()) as AlertSettings;
      await api.call(saveAlertSettingsEndpoint, { body });
      return { ok: true };
    } catch (error) {
      if (!(error instanceof ApiError) || error.status >= 500) throw error;
      return { ok: false, message: error.message };
    }
  };
}
