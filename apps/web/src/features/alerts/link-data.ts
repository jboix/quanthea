/**
 * The panels an alert is shown on, through the API: read them, link a panel or unlink it, dismiss
 * a suggested one, and list the pinned dashboards' panels to pick one. The alert page's action
 * and the agent's card in an alert thread both submit these intents.
 */
import {
  type AlertLinks,
  dismissLinkEndpoint,
  getAlertLinksEndpoint,
  type LinkTarget,
  linkAlertEndpoint,
  listLinkTargetsEndpoint,
  unlinkAlertEndpoint,
} from '@quanthea/shared';
import type { LoaderFunctionArgs } from 'react-router';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';

/** What changes a link, as JSON. */
export type LinkIntent =
  | {
      readonly intent: 'link';
      readonly dashboardId: string;
      readonly panelId: string;
      readonly how: 'agent' | 'by_hand' | 'query_match';
    }
  | { readonly intent: 'unlink'; readonly dashboardId: string; readonly panelId: string }
  | { readonly intent: 'dismissLink'; readonly dashboardId: string; readonly panelId: string };

/** The names of the intents that change links. */
const linkIntents: ReadonlySet<string> = new Set(['link', 'unlink', 'dismissLink']);

/**
 * Whether an intent changes a link.
 *
 * @param intent - The intent.
 * @param intent.intent - Its name.
 * @returns Whether it does.
 */
export function isLinkIntent(intent: { readonly intent: string }): intent is LinkIntent {
  return linkIntents.has(intent.intent);
}

/**
 * Runs a link intent.
 *
 * @param api - The API client.
 * @param alertId - The alert.
 * @param intent - The intent.
 * @returns Where the alert is shown now.
 */
export function runLinkIntent(
  api: ApiClient,
  alertId: string,
  intent: LinkIntent,
): Promise<AlertLinks> {
  const panel = { dashboardId: intent.dashboardId, panelId: intent.panelId };
  if (intent.intent === 'unlink')
    return api.call(unlinkAlertEndpoint, { params: { alertId, ...panel } });
  const params = { alertId };
  if (intent.intent === 'dismissLink')
    return api.call(dismissLinkEndpoint, { params, body: panel });
  return api.call(linkAlertEndpoint, { params, body: { ...panel, how: intent.how } });
}

/**
 * Reads where an alert is shown.
 *
 * @param api - The API client.
 * @param alertId - The alert.
 * @param signal - Aborts the call.
 * @returns The links, and for editors the suggestions and dismissals.
 */
export function readAlertLinks(
  api: ApiClient,
  alertId: string,
  signal?: AbortSignal,
): Promise<AlertLinks> {
  return api.call(getAlertLinksEndpoint, { params: { alertId } }, { signal });
}

/** What a resource load answers: the data, or why it failed. */
export type LinkLoad<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly message: string };

/**
 * Awaits a call, keeping an API error as a message.
 *
 * @param call - The pending call.
 * @returns The value, or the message.
 */
async function settle<Value>(call: Promise<Value>): Promise<LinkLoad<Value>> {
  try {
    return { ok: true, value: await call };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return { ok: false, message: error.message };
  }
}

/**
 * The loader of an alert's links resource route, for the agent's card in an alert thread.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadAlertLinks(api: ApiClient) {
  return ({ params, request }: LoaderFunctionArgs): Promise<LinkLoad<AlertLinks>> =>
    settle(readAlertLinks(api, params.alertId ?? '', request.signal));
}

/**
 * The loader of the pinned dashboards' panels resource route, for Link to a panel.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadLinkTargets(api: ApiClient) {
  return async ({ request }: LoaderFunctionArgs): Promise<LinkLoad<LinkTarget[]>> => {
    const listed = await settle(
      api.call(listLinkTargetsEndpoint, undefined, { signal: request.signal }),
    );
    return listed.ok ? { ok: true, value: listed.value.dashboards } : listed;
  };
}
