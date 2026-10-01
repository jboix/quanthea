/** The route tree (React Router data mode) and the browser router built from it. */
import { getManagedSettingsEndpoint } from '@quanthea/shared';
import {
  createBrowserRouter,
  type LoaderFunctionArgs,
  type RouteObject,
  redirect,
} from 'react-router';
import type { ApiClient } from '../lib/api-client.ts';
import { accountRoute } from '../routes/account.tsx';
import { binRoute } from '../routes/bin.tsx';
import { connectorRoutes } from '../routes/connectors.tsx';
import { dashboardRoutes } from '../routes/dashboard.tsx';
import { libraryRoute } from '../routes/library.tsx';
import { loginRoute, setPasswordRoute, setupRoute } from '../routes/login.tsx';
import { NotFoundRoute } from '../routes/not-found.tsx';
import { authSettingsRoute } from '../routes/settings-auth.tsx';
import { chartSettingsRoute } from '../routes/settings-charts.tsx';
import { SettingsLayout } from '../routes/settings-layout.tsx';
import { modelSettingsRoute } from '../routes/settings-model.tsx';
import { querySettingsRoute } from '../routes/settings-queries.tsx';
import { serverSettingsRoute } from '../routes/settings-server.tsx';
import { usageSettingsRoute } from '../routes/settings-usage.tsx';
import { usersSettingsRoute } from '../routes/settings-users.tsx';
import { threadRoutes } from '../routes/thread.tsx';
import { ErrorPage } from './error-page.tsx';
import { AppLayout, LoadingScreen } from './layout.tsx';
import { homePathFor, requireRole } from './route-access.ts';
import type { SessionLoader } from './session.ts';

/** What the routes need from the app: the session and the API. */
interface RouteDependencies {
  /** Loads the current session. */
  readonly loadSession: SessionLoader;
  /** Calls the API. */
  readonly api: ApiClient;
}

/**
 * The settings: a layout that loads which sections the configuration file manages, and one route
 * per section.
 *
 * @param dependencies - The session loader and the API client.
 * @returns The settings route.
 */
function settingsRoute({ loadSession, api }: RouteDependencies): RouteObject {
  return {
    id: 'settings',
    path: '/settings',
    loader: async (args: LoaderFunctionArgs) => {
      await requireRole(loadSession, 'admin')(args);
      return api.call(getManagedSettingsEndpoint, undefined, { signal: args.request.signal });
    },
    Component: SettingsLayout,
    children: [
      { index: true, loader: () => redirect('/settings/model') },
      modelSettingsRoute(loadSession, api),
      chartSettingsRoute(loadSession, api),
      querySettingsRoute(loadSession, api),
      usageSettingsRoute(loadSession, api),
      usersSettingsRoute(loadSession, api),
      authSettingsRoute(loadSession, api),
      serverSettingsRoute(loadSession, api),
    ],
  };
}

/**
 * The screens inside the layout, with `/` redirecting by role and `/settings` to its first section.
 *
 * @param dependencies - The session loader and the API client.
 * @returns The child routes of the layout.
 */
function screenRoutes({ loadSession, api }: RouteDependencies): RouteObject[] {
  const home = async () => {
    const session = await loadSession();
    return redirect(session ? homePathFor(session.principal.role) : '/login');
  };
  return [
    { index: true, loader: home },
    ...threadRoutes(loadSession, api),
    libraryRoute(loadSession, api),
    accountRoute(loadSession, api),
    ...dashboardRoutes(loadSession, api),
    binRoute(loadSession, api),
    connectorRoutes(loadSession, api),
    settingsRoute({ loadSession, api }),
    {
      path: '/ui',
      lazy: { Component: async () => (await import('../routes/ui-kit.tsx')).UiKitRoute },
    },
    { path: '*', Component: NotFoundRoute },
  ];
}

/**
 * The whole route tree. The root loader requires a session, so every screen below it can rely on
 * one. Screen errors render inside the layout, so the rail stays visible.
 *
 * @param dependencies - The session loader and the API client.
 * @returns The routes.
 */
export function createRoutes(dependencies: RouteDependencies): RouteObject[] {
  const { loadSession } = dependencies;
  return [
    loginRoute(loadSession, dependencies.api),
    setPasswordRoute(dependencies.api),
    setupRoute(loadSession, dependencies.api),
    {
      id: 'root',
      path: '/',
      loader: requireRole(loadSession, 'viewer'),
      Component: AppLayout,
      HydrateFallback: LoadingScreen,
      ErrorBoundary: ErrorPage,
      children: [{ ErrorBoundary: ErrorPage, children: screenRoutes(dependencies) }],
    },
  ];
}

/**
 * Creates the browser router.
 *
 * @param dependencies - The session loader and the API client.
 * @returns The router to hand to `RouterProvider`.
 */
export function createAppRouter(dependencies: RouteDependencies) {
  return createBrowserRouter(createRoutes(dependencies));
}
