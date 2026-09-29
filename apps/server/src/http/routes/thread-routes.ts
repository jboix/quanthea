/** The thread endpoints: list, create, read and delete threads, decide plans, and undo. Editors. */
import {
  approvePlanEndpoint,
  createThreadEndpoint,
  deleteThreadEndpoint,
  getThreadEndpoint,
  listThreadsEndpoint,
  rejectPlanEndpoint,
  restoreVersionEndpoint,
  startFromPinnedEndpoint,
  threadFromDashboardEndpoint,
} from '@querent/shared';
import type { Hono } from 'hono';
import type { Dashboards } from '../../dashboards/dashboards.ts';
import type { ModelView } from '../../gate/model-view.ts';
import { AppError } from '../../lib/errors.ts';
import type { ModelSettingsService } from '../../settings/model-settings.ts';
import type { ThreadBin } from '../../threads/bin.ts';
import { nextState } from '../../threads/state.ts';
import type { Threads } from '../../threads/threads.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { actorOf } from '../principal.ts';

/** The services the thread endpoints use. */
export interface ThreadRouteServices {
  /** The threads. */
  readonly threads: Threads;
  /** The dashboards, for Undo. */
  readonly dashboards: Dashboards;
  /** The model settings, for the model's name. */
  readonly modelSettings: ModelSettingsService;
  /** The model view, for the connectors and their access levels. */
  readonly modelView: ModelView;
  /** The bin, where deleted threads go. */
  readonly bin: ThreadBin;
}

/**
 * Whether a thread's dashboard has a pinned version.
 *
 * @param dashboards - The dashboards service.
 * @param dashboardId - The thread's dashboard, if it has one.
 * @returns Whether it is pinned; `false` when it is gone.
 */
function isPinned(dashboards: Dashboards, dashboardId: string | null): boolean {
  if (dashboardId === null) return false;
  try {
    return dashboards.get(dashboardId, 'editor').pinnedVersion !== null;
  } catch (error) {
    if (error instanceof AppError && error.code === 'not_found') return false;
    throw error;
  }
}

/**
 * The threads, each marked with whether its dashboard has a pinned version.
 *
 * @param services - The thread route services.
 * @returns The threads, newest first.
 */
function listThreads(services: ThreadRouteServices) {
  return services.threads.list().map((thread) => ({
    ...thread,
    pinned: isPinned(services.dashboards, thread.dashboardId),
  }));
}

/**
 * Mounts the endpoints that list, create, read and delete threads.
 *
 * @param app - The app.
 * @param services - The thread route services.
 */
function mountThreadRoutes(app: Hono<AppEnv>, services: ThreadRouteServices): void {
  const { threads } = services;
  mountEndpoint(app, listThreadsEndpoint, {
    access: 'editor',
    handle: () => listThreads(services),
  });
  mountEndpoint(app, createThreadEndpoint, {
    access: 'editor',
    handle: ({ body, principal }) => {
      const known = services.modelSettings.gateway().providers.map((config) => config.id);
      if (body.providerId !== undefined && !known.includes(body.providerId))
        throw new AppError('bad_request', `No model provider "${body.providerId}".`);
      return threads.create(actorOf(principal), body.providerId, body.queries);
    },
  });
  mountEndpoint(app, getThreadEndpoint, {
    access: 'editor',
    handle: async ({ params }) => {
      const thread = threads.get(params.threadId);
      const { settings, providerName } = await services.modelSettings.resolve(thread.providerId);
      const connectors = services.modelView
        .connectors()
        .map(({ name, accessLevel }) => ({ name, accessLevel }));
      return { ...thread, model: settings.models.build, providerName, connectors };
    },
  });
  mountEndpoint(app, deleteThreadEndpoint, {
    access: 'editor',
    handle: ({ params, principal }) => {
      services.bin.bin(params.threadId, actorOf(principal));
      return { binned: true as const };
    },
  });
}

/**
 * Mounts the endpoints that decide plans and undo a version.
 *
 * @param app - The app.
 * @param threads - The threads service.
 * @param dashboards - The dashboards service, for Undo.
 */
function mountDecisionRoutes(app: Hono<AppEnv>, threads: Threads, dashboards: Dashboards): void {
  mountEndpoint(app, approvePlanEndpoint, {
    access: 'editor',
    handle: ({ params, principal }) =>
      threads.decidePlan(params.threadId, params.planId, 'approve', actorOf(principal)),
  });
  mountEndpoint(app, rejectPlanEndpoint, {
    access: 'editor',
    handle: ({ params, principal }) =>
      threads.decidePlan(params.threadId, params.planId, 'reject', actorOf(principal)),
  });
  mountEndpoint(app, restoreVersionEndpoint, {
    access: 'editor',
    handle: ({ params, body, principal }) => {
      const { dashboardId } = threads.row(params.threadId);
      if (dashboardId === null)
        throw new AppError('bad_request', 'This thread has no dashboard yet.');
      return { version: dashboards.restore(dashboardId, body.version, actorOf(principal)) };
    },
  });
}

/**
 * Starts a thread's draft from a copy of a pinned dashboard, with no model: checks the thread can
 * take it before copying, sets a pending plan aside, then attaches the copy.
 *
 * @param services - The threads and dashboards.
 * @param threadId - The thread.
 * @param dashboardId - The pinned dashboard.
 * @param actor - Who starts from it.
 * @returns The copy and its version.
 * @throws {AppError} `bad_request` when the thread has a dashboard or is building.
 */
function startFromPinned(
  services: Pick<ThreadRouteServices, 'threads' | 'dashboards'>,
  threadId: string,
  dashboardId: string,
  actor: string,
) {
  const { threads, dashboards } = services;
  const thread = threads.get(threadId);
  if (thread.dashboardId !== null || nextState(thread.state, 'copied') === undefined)
    throw new AppError('bad_request', 'This thread already has a draft.');
  const pending = thread.plans.find((plan) => plan.status === 'pending');
  if (pending) threads.decidePlan(threadId, pending.id, 'reject', actor);
  const copy = dashboards.copyPinned(dashboardId, actor);
  threads.attachDashboard(threadId, copy.dashboardId, copy.title);
  threads.apply(threadId, 'copied');
  return { dashboardId: copy.dashboardId, version: copy.version };
}

/**
 * Opens a new thread on a dashboard, ready for edits, with no model: on a copy of a version, or on
 * the dashboard itself when it has no thread.
 *
 * @param services - The threads and dashboards.
 * @param dashboardId - The dashboard.
 * @param request - `copy` with the version to copy (the pinned one by default), or `edit`.
 * @param request.mode - Copy the dashboard, or edit it.
 * @param request.version - The version to copy.
 * @param actor - Who opens the thread.
 * @returns The new thread's id.
 * @throws {AppError} `bad_request` to edit a dashboard that has a thread.
 */
function threadFromDashboard(
  services: Pick<ThreadRouteServices, 'threads' | 'dashboards' | 'bin'>,
  dashboardId: string,
  request: { readonly mode: 'copy' | 'edit'; readonly version?: number | undefined },
  actor: string,
) {
  const { threads, dashboards } = services;
  const detail = dashboards.get(dashboardId, 'editor');
  const owner = services.bin.ownerOf(dashboardId);
  if (request.mode === 'edit' && owner !== null)
    throw new AppError(
      'bad_request',
      owner.binned
        ? 'Its thread is in the bin. Restore it to edit.'
        : 'This dashboard has a thread. Open it to edit.',
    );
  const version = request.version ?? detail.pinnedVersion ?? detail.versions.at(-1)?.version ?? 1;
  const target =
    request.mode === 'edit'
      ? { dashboardId, title: detail.title }
      : dashboards.copyVersion(dashboardId, version, actor);
  const thread = threads.create(actor);
  threads.attachDashboard(thread.id, target.dashboardId, target.title);
  threads.apply(thread.id, 'copied');
  return { threadId: thread.id };
}

/**
 * Mounts every thread endpoint except the streamed chat.
 *
 * @param app - The app.
 * @param services - The threads, dashboards, model settings and model view.
 */
export function mountThreadEndpoints(app: Hono<AppEnv>, services: ThreadRouteServices): void {
  mountThreadRoutes(app, services);
  mountDecisionRoutes(app, services.threads, services.dashboards);
  mountEndpoint(app, startFromPinnedEndpoint, {
    access: 'editor',
    handle: ({ params, body, principal }) =>
      startFromPinned(services, params.threadId, body.dashboardId, actorOf(principal)),
  });
  mountEndpoint(app, threadFromDashboardEndpoint, {
    access: 'editor',
    handle: ({ params, body, principal }) =>
      threadFromDashboard(services, params.dashboardId, body, actorOf(principal)),
  });
}
