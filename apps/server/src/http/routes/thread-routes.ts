/** The thread endpoints: list, create, read and delete threads, decide plans, and undo. Editors. */
import {
  approvePlanEndpoint,
  createThreadEndpoint,
  deleteThreadEndpoint,
  getThreadEndpoint,
  listThreadsEndpoint,
  rejectPlanEndpoint,
  restoreVersionEndpoint,
} from '@querent/shared';
import type { Hono } from 'hono';
import type { Dashboards } from '../../dashboards/dashboards.ts';
import { AppError } from '../../lib/errors.ts';
import type { Threads } from '../../threads/threads.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { actorOf } from '../principal.ts';

/**
 * Mounts the endpoints that list, create, read and delete threads.
 *
 * @param app - The app.
 * @param threads - The threads service.
 */
function mountThreadRoutes(app: Hono<AppEnv>, threads: Threads): void {
  mountEndpoint(app, listThreadsEndpoint, { access: 'editor', handle: () => threads.list() });
  mountEndpoint(app, createThreadEndpoint, {
    access: 'editor',
    handle: ({ principal }) => threads.create(actorOf(principal)),
  });
  mountEndpoint(app, getThreadEndpoint, {
    access: 'editor',
    handle: ({ params }) => threads.get(params.threadId),
  });
  mountEndpoint(app, deleteThreadEndpoint, {
    access: 'editor',
    handle: ({ params, principal }) => {
      threads.remove(params.threadId, actorOf(principal));
      return { deleted: true as const };
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
 * Mounts every thread endpoint except the streamed chat.
 *
 * @param app - The app.
 * @param threads - The threads service.
 * @param dashboards - The dashboards service.
 */
export function mountThreadEndpoints(
  app: Hono<AppEnv>,
  threads: Threads,
  dashboards: Dashboards,
): void {
  mountThreadRoutes(app, threads);
  mountDecisionRoutes(app, threads, dashboards);
}
