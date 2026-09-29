/**
 * Loads dashboards and runs their panels through the API. Panel runs and variable options load
 * through resource routes, one fetcher each, so every panel loads, fails and refreshes on its own.
 */
import {
  type DashboardPage,
  type DashboardVersion,
  getDashboardEndpoint,
  getDashboardVersionEndpoint,
  type PanelRun,
  pinDashboardEndpoint,
  runPanelEndpoint,
  threadFromDashboardEndpoint,
  unpinDashboardEndpoint,
  variableOptionsEndpoint,
} from '@querent/shared';
import { type ActionFunctionArgs, data, type LoaderFunctionArgs, redirect } from 'react-router';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';

/** What the dashboard screen shows. */
export interface DashboardData {
  /** The dashboard and the versions the role may see. */
  readonly dashboard: DashboardPage;
  /** The version shown, with its spec. */
  readonly version: DashboardVersion;
}

/** The outcome of a load a fetcher makes: the data, or why it failed. */
export type Loaded<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly message: string };

/** The URL parameter prefix of a variable. */
const variablePrefix = 'var-';

/**
 * The version a URL asks for: its `:version`, else the pinned one, else the latest the role sees.
 *
 * @param dashboard - The dashboard.
 * @param requested - The `:version` parameter, if any.
 * @returns The version number, or `undefined` when there is none to show.
 */
function versionToShow(
  dashboard: DashboardPage,
  requested: string | undefined,
): number | undefined {
  if (requested !== undefined) return Number(requested);
  return dashboard.pinnedVersion ?? dashboard.versions.at(-1)?.version;
}

/**
 * Turns "not found" from the API into a 404 the error page words as such.
 *
 * @param error - What the call threw.
 * @returns Never.
 * @throws {Response} A 404 for `not_found`, else the error.
 */
function rethrow(error: unknown): never {
  if (error instanceof ApiError && error.code === 'not_found') {
    throw data(null, { status: 404, statusText: 'Not Found' });
  }
  throw error;
}

/**
 * The loader of the dashboard screen.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadDashboard(api: ApiClient) {
  return async ({ params, request }: LoaderFunctionArgs): Promise<DashboardData> => {
    const dashboardId = params.dashboardId ?? '';
    const options = { signal: request.signal };
    try {
      const dashboard = await api.call(getDashboardEndpoint, { params: { dashboardId } }, options);
      const number = versionToShow(dashboard, params.version);
      if (number === undefined) throw data(null, { status: 404, statusText: 'Not Found' });
      const input = { params: { dashboardId, version: String(number) } };
      const version = await api.call(getDashboardVersionEndpoint, input, options);
      return { dashboard, version };
    } catch (error) {
      return rethrow(error);
    }
  };
}

/**
 * Reads the viewer's choices from a resource URL: `from`, `to`, and every `var-` parameter.
 *
 * @param url - The resource URL.
 * @returns The variables and the time range.
 */
function choicesOf(url: URL) {
  const names = [
    ...new Set([...url.searchParams.keys()].filter((key) => key.startsWith(variablePrefix))),
  ];
  const variables = Object.fromEntries(
    names.map((key) => {
      const values = url.searchParams.getAll(key);
      return [key.slice(variablePrefix.length), values.length === 1 ? (values[0] ?? '') : values];
    }),
  );
  const [from, to] = [url.searchParams.get('from'), url.searchParams.get('to')];
  return { variables, ...(from && to ? { time: { from, to } } : {}) };
}

/**
 * Awaits a call a fetcher made, keeping any API error as a message.
 *
 * @param call - The pending call.
 * @returns The value, or the message.
 */
async function loaded<Value>(call: Promise<Value>): Promise<Loaded<Value>> {
  try {
    return { ok: true, value: await call };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return { ok: false, message: error.message };
  }
}

/**
 * What the dashboard screen submits, as JSON: show a version in the library or none, or open a
 * new thread on a copy of a version or on the dashboard itself.
 */
export type DashboardIntent =
  | { readonly intent: 'pin'; readonly version: number }
  | { readonly intent: 'unpin' }
  | { readonly intent: 'copy'; readonly version: number }
  | { readonly intent: 'edit' };

/**
 * Opens a new thread on a dashboard and goes to it.
 *
 * @param api - The API client.
 * @param dashboardId - The dashboard.
 * @param intent - Copy a version, or edit the dashboard itself.
 * @returns The redirect to the thread, or why it failed.
 */
async function openThread(
  api: ApiClient,
  dashboardId: string,
  intent: Extract<DashboardIntent, { intent: 'copy' | 'edit' }>,
): Promise<Response | Loaded<unknown>> {
  const body =
    intent.intent === 'copy'
      ? { mode: 'copy' as const, version: intent.version }
      : { mode: 'edit' as const };
  const outcome = await loaded(
    api.call(threadFromDashboardEndpoint, { params: { dashboardId }, body }),
  );
  return outcome.ok ? redirect(`/threads/${outcome.value.threadId}`) : outcome;
}

/**
 * The action of the dashboard screen: pin a version, then open the dashboard as the library shows
 * it; unpin, and stay; or open a new thread on it. A refusal, such as a failing panel, comes back
 * as a message.
 *
 * @param api - The API client.
 * @returns The action.
 */
export function changeDashboard(api: ApiClient) {
  return async ({ params, request }: ActionFunctionArgs): Promise<Response | Loaded<unknown>> => {
    const dashboardId = params.dashboardId ?? '';
    const intent = (await request.json()) as DashboardIntent;
    if (intent.intent === 'copy' || intent.intent === 'edit') {
      return openThread(api, dashboardId, intent);
    }
    if (intent.intent === 'unpin') {
      return loaded(api.call(unpinDashboardEndpoint, { params: { dashboardId } }));
    }
    const body = { version: intent.version };
    const outcome = await loaded(api.call(pinDashboardEndpoint, { params: { dashboardId }, body }));
    return outcome.ok ? redirect(`/d/${dashboardId}`) : outcome;
  };
}

/**
 * The loader of a panel's resource route: runs the panel with the URL's choices.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadPanelRun(api: ApiClient) {
  return ({ params, request }: LoaderFunctionArgs): Promise<Loaded<PanelRun>> => {
    const body = {
      dashboardId: params.dashboardId ?? '',
      version: Number(params.version),
      panelId: params.panelId ?? '',
      ...choicesOf(new URL(request.url)),
    };
    return loaded(api.call(runPanelEndpoint, { body }, { signal: request.signal }));
  };
}

/**
 * The loader of a variable's options resource route.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadVariableOptions(api: ApiClient) {
  return async ({ params, request }: LoaderFunctionArgs): Promise<Loaded<string[]>> => {
    const body = {
      dashboardId: params.dashboardId ?? '',
      version: Number(params.version),
      name: params.name ?? '',
      ...choicesOf(new URL(request.url)),
    };
    const result = await loaded(
      api.call(variableOptionsEndpoint, { body }, { signal: request.signal }),
    );
    return result.ok ? { ok: true, value: result.value.options } : result;
  };
}
