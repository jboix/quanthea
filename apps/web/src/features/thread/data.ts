/**
 * Loads threads and their dashboards, and changes them through the API: start a thread, decide a
 * plan, undo a version, pin one. The conversation itself streams through the chat endpoint.
 */
import {
  approvePlanEndpoint,
  createThreadEndpoint,
  type DashboardDetail,
  type DashboardVersion,
  deleteThreadEndpoint,
  getDashboardEndpoint,
  getDashboardVersionEndpoint,
  getThreadEndpoint,
  listProviderChoicesEndpoint,
  listRecipeChoicesEndpoint,
  listThreadsEndpoint,
  type ProviderChoice,
  pinDashboardEndpoint,
  type RecipeChoice,
  rejectPlanEndpoint,
  restoreVersionEndpoint,
  startFromPinnedEndpoint,
  type ThreadDetail,
  type ThreadRecipes,
  type ThreadSummary,
} from '@querent/shared';
import { type ActionFunctionArgs, data, type LoaderFunctionArgs, redirect } from 'react-router';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';

/** What the thread screen shows. */
export interface ThreadData {
  /** The thread, its messages and plans, the model and the connectors. */
  readonly thread: ThreadDetail;
  /** Its dashboard, once it has one. */
  readonly dashboard: DashboardDetail | null;
  /** The version the right pane shows: `?v=`, else the latest. */
  readonly version: DashboardVersion | null;
}

/** What the thread screen submits, as JSON. */
export type ThreadIntent =
  | { readonly intent: 'approve' | 'reject'; readonly planId: string }
  | { readonly intent: 'restore'; readonly version: number }
  | { readonly intent: 'pin'; readonly version: number }
  | { readonly intent: 'startFrom'; readonly dashboardId: string };

/** The outcome of an intent: done, or why not. */
export type ThreadOutcome =
  | { readonly ok: true }
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
  const dashboard = thread.dashboardId
    ? await api.call(getDashboardEndpoint, { params: { dashboardId: thread.dashboardId } }, options)
    : null;
  const version = await versionToShow(api, dashboard, url.searchParams.get('v'), signal);
  return { thread, dashboard, version };
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

/** What the new-thread screen shows: the recent threads, and the providers a thread may use. */
export interface NewThreadData {
  /** The recent threads, the latest first. */
  readonly threads: readonly ThreadSummary[];
  /** The providers a thread may use. */
  readonly providers: readonly ProviderChoice[];
  /** The default provider. */
  readonly defaultProviderId: string;
  /** The recipes a thread may use. */
  readonly recipes: readonly RecipeChoice[];
}

/**
 * The loader of the new-thread screen: the recent threads and the providers.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadRecentThreads(api: ApiClient) {
  return async ({ request }: LoaderFunctionArgs): Promise<NewThreadData> => {
    const options = { signal: request.signal };
    const [threads, choices, { recipes }] = await Promise.all([
      api.call(listThreadsEndpoint, undefined, options),
      api.call(listProviderChoicesEndpoint, undefined, options),
      api.call(listRecipeChoicesEndpoint, undefined, options),
    ]);
    return { threads: threads.slice(0, 12), ...choices, recipes };
  };
}

/** What the new-thread screen submits, as JSON: a first question, or a past thread to delete. */
export type NewThreadIntent =
  | {
      readonly intent: 'start';
      readonly question: string;
      readonly providerId?: string;
      readonly recipes?: ThreadRecipes;
    }
  | { readonly intent: 'delete'; readonly threadId: string };

/**
 * The action of the new-thread screen: starts a thread and hands the first question over, or
 * deletes a past thread.
 *
 * @param api - The API client.
 * @returns The action. Starting redirects to the thread, which sends the question.
 */
export function newThreadAction(api: ApiClient) {
  return async ({ request }: ActionFunctionArgs): Promise<Response | ThreadOutcome> => {
    const intent = (await request.json()) as NewThreadIntent;
    if (intent.intent === 'delete') {
      await api.call(deleteThreadEndpoint, { params: { threadId: intent.threadId } });
      return { ok: true };
    }
    const { providerId, recipes } = intent;
    const body = {
      ...(providerId === undefined ? {} : { providerId }),
      ...(recipes === undefined ? {} : { recipes }),
    };
    const thread = await api.call(createThreadEndpoint, { body });
    return redirect(`/threads/${thread.id}?ask=${encodeURIComponent(intent.question)}`);
  };
}

/**
 * Runs one intent.
 *
 * @param api - The API client.
 * @param threadId - The thread.
 * @param intent - The intent.
 * @returns When it is done.
 */
async function run(api: ApiClient, threadId: string, intent: ThreadIntent): Promise<void> {
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
  if (intent.intent === 'pin') {
    const { dashboardId } = await api.call(getThreadEndpoint, { params: { threadId } });
    await api.call(pinDashboardEndpoint, {
      params: { dashboardId: dashboardId ?? '' },
      body: { version: intent.version },
    });
    return;
  }
  const endpoint = intent.intent === 'approve' ? approvePlanEndpoint : rejectPlanEndpoint;
  await api.call(endpoint, { params: { threadId, planId: intent.planId } });
}

/**
 * The action of the thread screen: decide a plan, undo, or pin.
 *
 * @param api - The API client.
 * @returns The action. A refusal comes back as a message, not the error page.
 */
export function changeThread(api: ApiClient) {
  return async ({ request, params }: ActionFunctionArgs): Promise<ThreadOutcome> => {
    try {
      await run(api, params.threadId ?? '', (await request.json()) as ThreadIntent);
      return { ok: true };
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      return { ok: false, message: error.message };
    }
  };
}
