/** The thread endpoints: list, create, read and delete threads, decide plans, and undo. Editors. */
import {
  type AlertSeed,
  approvePlanEndpoint,
  createThreadEndpoint,
  deleteThreadEndpoint,
  getThreadEndpoint,
  listThreadsEndpoint,
  type Principal,
  rejectPlanEndpoint,
  restoreVersionEndpoint,
  startFromPinnedEndpoint,
  threadFromDashboardEndpoint,
} from '@quanthea/shared';
import type { Hono } from 'hono';
import type { Users } from '../../auth/users.ts';
import type { Dashboards } from '../../dashboards/dashboards.ts';
import type { ModelView } from '../../gate/model-view.ts';
import { AppError } from '../../lib/errors.ts';
import type { ModelSettingsService } from '../../settings/model-settings.ts';
import type { ThreadBin } from '../../threads/bin.ts';
import { nextState } from '../../threads/state.ts';
import type { Threads } from '../../threads/threads.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { canWrite, checkThread, ownerNames, roleForDashboard } from '../ownership.ts';
import { actorOf, signedIn } from '../principal.ts';

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
  /** The users, for owners' names. */
  readonly users: Pick<Users, 'nameOf'>;
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
 * The threads someone sees: their own, or everyone's for an admin who asks. Each is marked with
 * whether its dashboard has a pinned version, and named by its owner when it is someone else's.
 *
 * @param services - The thread route services.
 * @param principal - Who asks.
 * @param scope - Their own threads, or everyone's.
 * @returns The threads, newest first.
 */
function listThreads(
  services: ThreadRouteServices,
  principal: Principal,
  scope: 'mine' | 'everyone',
) {
  const everyone = scope === 'everyone' && principal.role === 'admin';
  const nameOf = ownerNames(services.users);
  const shown = services.threads
    .list()
    .filter((thread) => (everyone ? true : thread.ownerId === principal.id));
  return Promise.all(
    shown.map(async (thread) => ({
      ...thread,
      pinned: isPinned(services.dashboards, thread.dashboardId),
      ownerName: thread.ownerId === principal.id ? null : await nameOf(thread.ownerId),
    })),
  );
}

/**
 * Checks the panel an alert thread starts from: only an alert thread takes one, and the person
 * must see the version and the version must have the panel.
 *
 * @param services - The thread route services.
 * @param kind - What the thread makes.
 * @param seed - The panel.
 * @param principal - Who starts the thread.
 * @throws {AppError} `bad_request` for a dashboard thread or a panel the version has not;
 *   `not_found` for a version the person may not see.
 */
function checkSeed(
  services: ThreadRouteServices,
  kind: 'dashboard' | 'alert',
  seed: AlertSeed,
  principal: Principal,
): void {
  if (kind !== 'alert')
    throw new AppError('bad_request', 'Only an alert thread starts from a panel.');
  const role = roleForDashboard(principal, services.bin.ownerOf(seed.dashboardId));
  const { spec } = services.dashboards.getVersion(seed.dashboardId, seed.version, role);
  if (!spec.panels.some((panel) => panel.id === seed.panelId))
    throw new AppError('bad_request', `Version ${seed.version} has no panel ${seed.panelId}.`);
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
    handle: ({ principal, query }) => listThreads(services, signedIn(principal), query.scope),
  });
  mountEndpoint(app, createThreadEndpoint, {
    access: 'editor',
    handle: ({ body, principal }) => {
      const known = services.modelSettings.gateway().providers.map((config) => config.id);
      if (body.providerId !== undefined && !known.includes(body.providerId))
        throw new AppError('bad_request', `No model provider "${body.providerId}".`);
      if (body.seed !== undefined) checkSeed(services, body.kind, body.seed, signedIn(principal));
      const start = { kind: body.kind, seed: body.seed };
      return threads.create(actorOf(principal), body.providerId, body.queries, start);
    },
  });
  mountEndpoint(app, deleteThreadEndpoint, {
    access: 'editor',
    handle: ({ params, principal }) => {
      checkThread(threads, signedIn(principal), params.threadId, 'read');
      services.bin.bin(params.threadId, actorOf(principal));
      return { binned: true as const };
    },
  });
}

/**
 * Mounts the endpoint that reads a thread: for its owner, or an admin, who may only read it.
 *
 * @param app - The app.
 * @param services - The thread route services.
 */
function mountThreadReadRoute(app: Hono<AppEnv>, services: ThreadRouteServices): void {
  const { threads } = services;
  mountEndpoint(app, getThreadEndpoint, {
    access: 'editor',
    handle: async ({ params, principal }) => {
      const reader = signedIn(principal);
      checkThread(threads, reader, params.threadId, 'read');
      const thread = threads.get(params.threadId);
      const { settings, providerName } = await services.modelSettings.resolve(thread.providerId);
      const connectors = services.modelView
        .connectors()
        .map(({ name, accessLevel }) => ({ name, accessLevel }));
      const ownerName = await ownerNames(services.users)(thread.ownerId);
      const readOnly = !canWrite(reader, thread.ownerId);
      const model = settings.models.build;
      return { ...thread, model, providerName, connectors, ownerName, readOnly };
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
    handle: ({ params, principal }) => {
      checkThread(threads, signedIn(principal), params.threadId, 'write');
      return threads.decidePlan(params.threadId, params.planId, 'approve', actorOf(principal));
    },
  });
  mountEndpoint(app, rejectPlanEndpoint, {
    access: 'editor',
    handle: ({ params, principal }) => {
      checkThread(threads, signedIn(principal), params.threadId, 'write');
      return threads.decidePlan(params.threadId, params.planId, 'reject', actorOf(principal));
    },
  });
  mountEndpoint(app, restoreVersionEndpoint, {
    access: 'editor',
    handle: ({ params, body, principal }) => {
      checkThread(threads, signedIn(principal), params.threadId, 'write');
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
 * Refuses to edit a dashboard in a new thread when it already has one.
 *
 * @param owner - The dashboard's thread, if any.
 * @throws {AppError} `bad_request` when it has one, in the bin or not.
 */
function refuseSecondThread(owner: { readonly binned: boolean } | null): void {
  if (owner === null) return;
  throw new AppError(
    'bad_request',
    owner.binned
      ? 'Its thread is in the bin. Restore it to edit.'
      : 'This dashboard has a thread. Open it to edit.',
  );
}

/**
 * Opens a new thread on a dashboard, ready for edits, with no model: on a copy of a version the
 * person may see, or on the dashboard itself when it has no thread.
 *
 * @param services - The threads, dashboards and bin.
 * @param dashboardId - The dashboard.
 * @param request - `copy` with the version to copy (the pinned one by default), or `edit`.
 * @param request.mode - Copy the dashboard, or edit it.
 * @param request.version - The version to copy.
 * @param principal - Who opens the thread, and will own it.
 * @returns The new thread's id.
 * @throws {AppError} `bad_request` to edit a dashboard that has a thread; `not_found` for a
 *   version the person may not see.
 */
function threadFromDashboard(
  services: Pick<ThreadRouteServices, 'threads' | 'dashboards' | 'bin'>,
  dashboardId: string,
  request: { readonly mode: 'copy' | 'edit'; readonly version?: number | undefined },
  principal: Principal,
) {
  const { threads, dashboards } = services;
  const owner = services.bin.ownerOf(dashboardId);
  const role = roleForDashboard(principal, owner);
  const detail = dashboards.get(dashboardId, role);
  if (request.mode === 'edit') refuseSecondThread(owner);
  const version = request.version ?? detail.pinnedVersion ?? detail.versions.at(-1)?.version ?? 1;
  // Copying reads the version as the person may see it, so no draft of another is copied.
  if (request.mode === 'copy') dashboards.getVersion(dashboardId, version, role);
  const target =
    request.mode === 'edit'
      ? { dashboardId, title: detail.title }
      : dashboards.copyVersion(dashboardId, version, principal.id);
  const thread = threads.create(principal.id);
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
  mountThreadReadRoute(app, services);
  mountDecisionRoutes(app, services.threads, services.dashboards);
  mountEndpoint(app, startFromPinnedEndpoint, {
    access: 'editor',
    handle: ({ params, body, principal }) => {
      checkThread(services.threads, signedIn(principal), params.threadId, 'write');
      return startFromPinned(services, params.threadId, body.dashboardId, actorOf(principal));
    },
  });
  mountEndpoint(app, threadFromDashboardEndpoint, {
    access: 'editor',
    handle: ({ params, body, principal }) =>
      threadFromDashboard(services, params.dashboardId, body, signedIn(principal)),
  });
}
