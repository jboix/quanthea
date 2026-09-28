/** The routes of the connectors screen, composed from the connectors feature. */
import type { ComponentType } from 'react';
import type { ActionFunctionArgs, LoaderFunctionArgs, RouteObject } from 'react-router';
import { ErrorPage } from '../app/error-page.tsx';
import { type GuardedPath, guarded } from '../app/route-access.ts';
import type { SessionLoader } from '../app/session.ts';
import {
  addConnector,
  ConnectorScreen,
  ConnectorsIndex,
  ConnectorsLayout,
  changeConnector,
  connectorsRouteId,
  EditConnectorScreen,
  editConnector,
  loadConnector,
  loadConnectors,
  loadHealth,
  NewConnectorScreen,
} from '../features/connectors/index.ts';
import type { ApiClient } from '../lib/api-client.ts';

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
 * @param Component - The screen.
 * @returns The route object.
 */
function childRoute(
  loadSession: SessionLoader,
  path: GuardedPath,
  handlers: Handlers,
  Component: ComponentType,
): RouteObject {
  const { loader, action } = handlers;
  return {
    path,
    ErrorBoundary: ErrorPage,
    Component,
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
    { index: true, Component: ConnectorsIndex },
    childRoute(loadSession, '/connectors/new', add, NewConnectorScreen),
    childRoute(loadSession, '/connectors/:connectorId', detail, ConnectorScreen),
    childRoute(loadSession, '/connectors/:connectorId/edit', edit, EditConnectorScreen),
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
    Component: ConnectorsLayout,
    children: connectorChildren(loadSession, api),
  };
}
