/** The routes of threads: the new-thread screen and a thread with its draft. */
import type { RouteObject } from 'react-router';
import { ErrorPage } from '../app/error-page.tsx';
import { guarded } from '../app/route-access.ts';
import type { SessionLoader } from '../app/session.ts';
import {
  changeThread,
  loadRecentThreads,
  loadThread,
  NewThreadScreen,
  startThread,
  ThreadScreen,
} from '../features/thread/index.ts';
import type { ApiClient } from '../lib/api-client.ts';

/**
 * The thread routes. Starting a thread redirects to it with the first question in `?ask=`.
 *
 * @param loadSession - Loads the current session.
 * @param api - The API client.
 * @returns The route objects.
 */
export function threadRoutes(loadSession: SessionLoader, api: ApiClient): RouteObject[] {
  const start = '/threads/new';
  const thread = '/threads/:threadId';
  return [
    {
      path: start,
      loader: guarded(loadSession, start, loadRecentThreads(api)),
      action: guarded(loadSession, start, startThread(api)),
      Component: NewThreadScreen,
      ErrorBoundary: ErrorPage,
    },
    {
      path: thread,
      loader: guarded(loadSession, thread, loadThread(api)),
      action: guarded(loadSession, thread, changeThread(api)),
      Component: ThreadScreen,
      ErrorBoundary: ErrorPage,
    },
  ];
}
