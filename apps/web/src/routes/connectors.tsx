/** The routes of the connectors screen, composed from the connectors feature. */
import type { ComponentType } from 'react';
import type { ActionFunctionArgs, LoaderFunctionArgs, RouteObject } from 'react-router';
import { ErrorPage } from '../app/error-page.tsx';
import { type GuardedPath, guarded } from '../app/route-access.ts';
import type { SessionLoader } from '../app/session.ts';
import {
  addConnector,
  changeConnector,
  connectorsRouteId,
  editConnector,
  loadConnector,
  loadConnectors,
  loadHealth,
} from '../features/connectors/index.ts';
import type { ApiClient } from '../lib/api-client.ts';

/** The connector screens, by name. */
type Screens = typeof import('../features/connectors/screens.ts');

/**
 * Loads a connector screen when its route first opens.
 *
 * @param name - The screen.
 * @returns The loader of its component.
 */
function screen(name: keyof Screens): () => Promise<ComponentType> {
  return async () => (await import('../features/connectors/screens.ts'))[name];
}

/** The loader and action of a connectors route. */
interface Handlers {
  /** Loads the route's data. */
  readonly loader: (args: LoaderFunctionArgs) => Promise<unknown>;
  /** Handles the route's submissions. */
  readonly action?: (args: ActionFunctionArgs) => Promise<unknown>;
}

/**
 * A connectors child route whose loader and action run only for admins. Its errors render in
 * place, so the list stays visible.
 *
 * @param loadSession - Loads the current session.
 * @param path - The guarded path.
 * @param handlers - The loader and action.
 * @param screen - Loads the screen, when the route first opens.
 * @returns The route object.
 */
function childRoute(
  loadSession: SessionLoader,
  path: GuardedPath,
  handlers: Handlers,
  screen: () => Promise<ComponentType>,
): RouteObject {
  const { loader, action } = handlers;
  return {
    path,
    ErrorBoundary: ErrorPage,
    lazy: { Component: screen },
    loader: guarded(loadSession, path, loader),
    ...(action ? { action: guarded(loadSession, path, action) } : {}),
  };
}

/**
 * The children of the connectors layout: the add form, one connector, its edit form, and its
 * health. Health is a resource route without a screen: fetchers load it, and it never revalidates
 * on its own, so a slow source is tested only when asked.
 *
 * @param loadSession - Loads the current session.
 * @param api - The API client.
 * @returns The child routes.
 */
function connectorChildren(loadSession: SessionLoader, api: ApiClient): RouteObject[] {
  const health = '/connectors/:connectorId/health';
  const detail = { loader: loadConnector(api), action: changeConnector(api) };
  const edit = { loader: loadConnector(api), action: editConnector(api) };
  const add = { loader: () => Promise.resolve(null), action: addConnector(api) };
  return [
    { index: true, lazy: { Component: screen('ConnectorsIndex') } },
    childRoute(loadSession, '/connectors/new', add, screen('NewConnectorScreen')),
    childRoute(loadSession, '/connectors/:connectorId', detail, screen('ConnectorScreen')),
    childRoute(loadSession, '/connectors/:connectorId/edit', edit, screen('EditConnectorScreen')),
    {
      path: health,
      loader: guarded(loadSession, health, loadHealth(api)),
      shouldRevalidate: () => false,
    },
  ];
}

/**
 * The connectors layout, with the list, and its children.
 *
 * @param loadSession - Loads the current session.
 * @param api - The API client.
 * @returns The route object.
 */
export function connectorRoutes(loadSession: SessionLoader, api: ApiClient): RouteObject {
  return {
    id: connectorsRouteId,
    path: '/connectors',
    loader: guarded(loadSession, '/connectors', loadConnectors(api)),
    lazy: { Component: screen('ConnectorsLayout') },
    children: connectorChildren(loadSession, api),
  };
}
