/**
 * Loads alerts and changes them through the API: the list, one alert, its replay over a window,
 * and the alert settings. The browser never sends a query: a replay names a saved version.
 */
import {
  type AlertDetail,
  type AlertLinks,
  type AlertListItem,
  type AlertReplay,
  type AlertSettings,
  type AlertSpec,
  activateAlertChangesEndpoint,
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
import { isLinkIntent, type LinkIntent, readAlertLinks, runLinkIntent } from './link-data.ts';

/** The resource route of the alert settings, which the Alerts page's Settings dialog loads. */
export const alertSettingsPath = '/alerts/settings';

/** What the alerts list shows. */
export interface AlertsData {
  /** Every alert the role sees. */
  readonly alerts: readonly AlertListItem[];
}

/** What an alert's page shows. */
export interface AlertData {
  /** The alert with its versions, series, changes, channels and sends. */
  readonly alert: AlertDetail;
  /** The panels it is shown on, and for editors the panels suggested. */
  readonly links: AlertLinks;
}

/** What the alert page submits, as JSON. */
export type AlertIntent =
  | { readonly intent: 'mute'; readonly until: number | null }
  | { readonly intent: 'unmute' }
  | { readonly intent: 'activate'; readonly version: number }
  | { readonly intent: 'activateChanges'; readonly basedOn: number; readonly spec: AlertSpec }
  | { readonly intent: 'deactivate' }
  | LinkIntent;

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
    const alertId = params.alertId ?? '';
    const { signal } = request;
    try {
      const [alert, links] = await Promise.all([
        api.call(getAlertEndpoint, { params: { alertId } }, { signal }),
        readAlertLinks(api, alertId, signal),
      ]);
      return { alert, links };
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
  if (isLinkIntent(intent)) await runLinkIntent(api, alertId, intent);
  else if (intent.intent === 'mute')
    await api.call(muteAlertEndpoint, { params, body: { until: intent.until } });
  else if (intent.intent === 'unmute') await api.call(unmuteAlertEndpoint, { params });
  else if (intent.intent === 'activate')
    await api.call(activateAlertEndpoint, { params, body: { version: intent.version } });
  else if (intent.intent === 'activateChanges') {
    const body = { basedOn: intent.basedOn, spec: intent.spec };
    await api.call(activateAlertChangesEndpoint, { params, body });
  } else await api.call(deactivateAlertEndpoint, { params });
}

/**
 * The action of the alert page: mute, unmute, activate a version or the changes made by hand,
 * deactivate, and link, unlink or dismiss a panel.
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
