/**
 * Loads threads and their dashboards, and changes them through the API: start a thread, decide a
 * plan, undo a version, pin one. The conversation itself streams through the chat endpoint.
 */
import {
  approvePlanEndpoint,
  type DashboardDetail,
  type DashboardVersion,
  getDashboardEndpoint,
  getDashboardVersionEndpoint,
  getThreadEndpoint,
  pinDashboardEndpoint,
  rejectPlanEndpoint,
  restoreVersionEndpoint,
  startFromPinnedEndpoint,
  type ThreadDetail,
  unpinDashboardEndpoint,
} from '@quanthea/shared';
import { type ActionFunctionArgs, data, type LoaderFunctionArgs } from 'react-router';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';
import {
  type AlertDraftData,
  type AlertIntent,
  errorText,
  isAlertIntent,
  loadAlertDraft,
  runAlertIntent,
} from '../alert-draft/index.ts';
import {
  isReportIntent,
  loadReportDraft,
  type ReportDraftData,
  type ReportIntent,
  runReportIntent,
} from '../report-draft/index.ts';

/** What the thread screen shows. */
export interface ThreadData {
  /** The thread, its messages and plans, the model and the connectors. */
  readonly thread: ThreadDetail;
  /** Its dashboard, once it has one. */
  readonly dashboard: DashboardDetail | null;
  /** The version the right pane shows: `?v=`, else the latest. */
  readonly version: DashboardVersion | null;
  /** The dashboard the draft was copied from, when it is a copy; its title is null once gone. */
  readonly parent: ParentDashboard | null;
  /** An alert thread's draft, once the agent wrote one. */
  readonly alertDraft: AlertDraftData | null;
  /** A report thread's draft, once the agent wrote one. */
  readonly reportDraft: ReportDraftData | null;
  /** The panel an alert thread started from, if any. */
  readonly origin: SeedPanel | null;
}

/** The panel an alert thread started from, with its dashboard. */
export interface SeedPanel {
  /** The dashboard. */
  readonly dashboardId: string;
  /** Its title on that version. */
  readonly dashboardTitle: string;
  /** The version. */
  readonly version: number;
  /** The panel. */
  readonly panelId: string;
  /** Its title. */
  readonly panelTitle: string;
}

/** The dashboard a draft was copied from. */
export interface ParentDashboard {
  /** Its id. */
  readonly dashboardId: string;
  /** Its title, or null when it was deleted since. */
  readonly title: string | null;
  /** The version copied. */
  readonly version: number;
}

/** What the thread screen submits, as JSON. */
export type ThreadIntent =
  | { readonly intent: 'approve' | 'reject'; readonly planId: string }
  | { readonly intent: 'restore'; readonly version: number }
  | DashboardIntent
  | { readonly intent: 'startFrom'; readonly dashboardId: string }
  | AlertIntent
  | ReportIntent;

/** What the thread screen asks of its dashboard: show a version in the library, or none. */
type DashboardIntent =
  | { readonly intent: 'pin'; readonly version: number }
  | { readonly intent: 'unpin' };

/** The outcome of an intent: done, or why not. */
export type ThreadOutcome =
  | { readonly ok: true; readonly message?: string | undefined }
  | { readonly ok: false; readonly message: string };

/**
 * Loads the version the right pane shows.
 *
 * @param api - The API client.
 * @param dashboard - The thread's dashboard, if any.
 * @param requested - The `?v=` parameter, if any.
 * @param signal - Aborted when the navigation changes.
 * @returns The version, or `null` before the first one.
 */
async function versionToShow(
  api: ApiClient,
  dashboard: DashboardDetail | null,
  requested: string | null,
  signal: AbortSignal,
): Promise<DashboardVersion | null> {
  const latest = dashboard?.versions.at(-1)?.version;
  if (!dashboard || latest === undefined) return null;
  const number = requested && /^\d+$/.test(requested) ? Number(requested) : latest;
  const params = { dashboardId: dashboard.id, version: String(Math.min(number, latest)) };
  return api.call(getDashboardVersionEndpoint, { params }, { signal });
}

/**
 * The dashboard a draft was copied from, if it is a copy.
 *
 * @param api - The API client.
 * @param dashboard - The thread's dashboard, if any.
 * @param signal - Aborted when the navigation changes.
 * @returns The parent, with no title when it is gone; or `null` for a draft that is no copy.
 */
async function parentOf(
  api: ApiClient,
  dashboard: DashboardDetail | null,
  signal: AbortSignal,
): Promise<ParentDashboard | null> {
  const dashboardId = dashboard?.parentDashboardId;
  const version = dashboard?.parentVersion;
  if (!dashboardId || version === undefined || version === null) return null;
  try {
    const parent = await api.call(getDashboardEndpoint, { params: { dashboardId } }, { signal });
    return { dashboardId, title: parent.title, version };
  } catch (error) {
    if (error instanceof ApiError && error.code === 'not_found')
      return { dashboardId, title: null, version };
    throw error;
  }
}

/**
 * The panel an alert thread started from, with the titles of that version.
 *
 * @param api - The API client.
 * @param seed - The thread's seed, if any.
 * @param signal - Aborted when the navigation changes.
 * @returns The panel, or `null` without a seed or once the version or panel is gone.
 */
async function originOf(
  api: ApiClient,
  seed: ThreadDetail['seed'],
  signal: AbortSignal,
): Promise<SeedPanel | null> {
  if (!seed) return null;
  const params = { dashboardId: seed.dashboardId, version: String(seed.version) };
  try {
    const { spec } = await api.call(getDashboardVersionEndpoint, { params }, { signal });
    const panel = spec.panels.find((each) => each.id === seed.panelId);
    if (!panel) return null;
    return { ...seed, dashboardTitle: spec.title, panelTitle: panel.title };
  } catch (error) {
    if (error instanceof ApiError && error.code === 'not_found') return null;
    throw error;
  }
}

/**
 * Fetches a thread, its dashboard and the version to show.
 *
 * @param api - The API client.
 * @param threadId - The thread.
 * @param url - The page URL, for `?v=`.
 * @param signal - Aborted when the navigation changes.
 * @returns The screen's data.
 */
async function fetchThread(
  api: ApiClient,
  threadId: string,
  url: URL,
  signal: AbortSignal,
): Promise<ThreadData> {
  const options = { signal };
  const thread = await api.call(getThreadEndpoint, { params: { threadId } }, options);
  const none = { dashboard: null, version: null, parent: null, alertDraft: null, origin: null };
  if (thread.kind === 'alert') {
    const alertDraft = await loadAlertDraft(api, thread.alertId, signal);
    const origin = await originOf(api, thread.seed, signal);
    return { ...none, thread, alertDraft, origin, reportDraft: null };
  }
  if (thread.kind === 'report')
    return { ...none, thread, reportDraft: await loadReportDraft(api, thread.reportId, signal) };
  const dashboard = thread.dashboardId
    ? await api.call(getDashboardEndpoint, { params: { dashboardId: thread.dashboardId } }, options)
    : null;
  const version = await versionToShow(api, dashboard, url.searchParams.get('v'), signal);
  const parent = await parentOf(api, dashboard, signal);
  return { thread, dashboard, version, parent, alertDraft: null, reportDraft: null, origin: null };
}

/**
 * The loader of the thread screen.
 *
 * @param api - The API client.
 * @returns The loader. An unknown thread is a 404.
 */
export function loadThread(api: ApiClient) {
  return async ({ params, request }: LoaderFunctionArgs): Promise<ThreadData> => {
    try {
      return await fetchThread(api, params.threadId ?? '', new URL(request.url), request.signal);
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'not_found') throw error;
      throw data(null, { status: 404, statusText: 'Not Found' });
    }
  };
}

/**
 * Pins a version of the thread's dashboard, or unpins it.
 *
 * @param api - The API client.
 * @param threadId - The thread.
 * @param intent - Pin or unpin.
 * @returns When it is done.
 */
async function runOnDashboard(
  api: ApiClient,
  threadId: string,
  intent: DashboardIntent,
): Promise<void> {
  const { dashboardId } = await api.call(getThreadEndpoint, { params: { threadId } });
  const params = { dashboardId: dashboardId ?? '' };
  if (intent.intent === 'unpin') await api.call(unpinDashboardEndpoint, { params });
  else await api.call(pinDashboardEndpoint, { params, body: { version: intent.version } });
}

/**
 * Runs one intent.
 *
 * @param api - The API client.
 * @param threadId - The thread.
 * @param intent - The intent.
 * @returns When it is done.
 */
async function run(
  api: ApiClient,
  threadId: string,
  intent: ThreadIntent,
): Promise<string | undefined> {
  if (isAlertIntent(intent)) return runAlertIntent(api, threadId, intent);
  if (isReportIntent(intent)) return runReportIntent(api, threadId, intent);
  if (intent.intent === 'restore') {
    await api.call(restoreVersionEndpoint, {
      params: { threadId },
      body: { version: intent.version },
    });
    return;
  }
  if (intent.intent === 'startFrom') {
    await api.call(startFromPinnedEndpoint, {
      params: { threadId },
      body: { dashboardId: intent.dashboardId },
    });
    return;
  }
  if (intent.intent === 'pin' || intent.intent === 'unpin') {
    await runOnDashboard(api, threadId, intent);
    return;
  }
  const endpoint = intent.intent === 'approve' ? approvePlanEndpoint : rejectPlanEndpoint;
  await api.call(endpoint, { params: { threadId, planId: intent.planId } });
  return undefined;
}

/**
 * The action of the thread screen: decide a plan, undo, pin or unpin.
 *
 * @param api - The API client.
 * @returns The action. A refusal comes back as a message, not the error page.
 */
export function changeThread(api: ApiClient) {
  return async ({ request, params }: ActionFunctionArgs): Promise<ThreadOutcome> => {
    try {
      const message = await run(api, params.threadId ?? '', (await request.json()) as ThreadIntent);
      return { ok: true, message };
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      return { ok: false, message: errorText(error) };
    }
  };
}
