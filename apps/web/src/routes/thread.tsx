/** The routes of threads: the new-thread screen and a thread with its draft. */
import type { RouteObject } from 'react-router';
import { ErrorPage } from '../app/error-page.tsx';
import { guarded } from '../app/route-access.ts';
import type { SessionLoader } from '../app/session.ts';
import { alertPreviewsAction } from '../features/alert-draft/index.ts';
import {
  changeThread,
  loadRecentThreads,
  loadThread,
  newThreadAction,
} from '../features/thread/index.ts';
import type { ApiClient } from '../lib/api-client.ts';

/**
 * The thread routes. Starting a thread redirects to it with the first question in `?ask=`. An
 * alert thread's draft pane asks for its previews through a resource route.
 *
 * @param loadSession - Loads the current session.
 * @param api - The API client.
 * @returns The route objects.
 */
export function threadRoutes(loadSession: SessionLoader, api: ApiClient): RouteObject[] {
  const start = '/threads/new';
  const thread = '/threads/:threadId';
  const previews = '/threads/:threadId/alert-previews';
  return [
    {
      path: start,
      loader: guarded(loadSession, start, loadRecentThreads(api)),
      action: guarded(loadSession, start, newThreadAction(api)),
      lazy: {
        Component: async () => (await import('../features/thread/screens.ts')).NewThreadScreen,
      },
      ErrorBoundary: ErrorPage,
    },
    {
      path: thread,
      loader: guarded(loadSession, thread, loadThread(api)),
      action: guarded(loadSession, thread, changeThread(api)),
      // Asking for an alert draft's previews changes nothing, so the thread does not load again.
      shouldRevalidate: ({ formAction, defaultShouldRevalidate }) =>
        formAction?.endsWith('/alert-previews') ? false : defaultShouldRevalidate,
      lazy: { Component: async () => (await import('../features/thread/screens.ts')).ThreadScreen },
      ErrorBoundary: ErrorPage,
    },
    // What each channel of an alert draft would send; a fetcher asks, nothing else reloads.
    {
      path: previews,
      loader: guarded(loadSession, previews, () => Promise.resolve(null)),
      action: guarded(loadSession, previews, alertPreviewsAction(api)),
      shouldRevalidate: () => false,
    },
  ];
}
