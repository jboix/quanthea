/**
 * The account resource routes: one's providers for the account menu and its actions, and one's API
 * tokens for the menu's tokens dialog.
 */
import { Navigate, type RouteObject } from 'react-router';
import { guarded } from '../app/route-access.ts';
import type { SessionLoader } from '../app/session.ts';
import { accountAction, loadAccount } from '../features/account/index.ts';
import { apiTokensAction, loadApiTokens } from '../features/api-tokens/index.ts';
import type { ApiClient } from '../lib/api-client.ts';

/**
 * What opening `/account` shows: nothing, the account lives in the menu, so it goes home.
 *
 * @returns The redirect.
 */
function HomeInstead() {
  return <Navigate to="/" replace />;
}

/**
 * The account route, for anyone signed in. The account menu loads and posts to it.
 *
 * @param loadSession - Loads the current session.
 * @param api - The API client.
 * @returns The route object.
 */
export function accountRoute(loadSession: SessionLoader, api: ApiClient): RouteObject {
  const path = '/account';
  return {
    path,
    loader: guarded(loadSession, path, loadAccount(api)),
    action: guarded(loadSession, path, accountAction(api)),
    Component: HomeInstead,
  };
}

/**
 * The MCP tokens route, for anyone signed in. The account menu's tokens dialog loads and posts to
 * it.
 *
 * @param loadSession - Loads the current session.
 * @param api - The API client.
 * @returns The route object.
 */
export function accountTokensRoute(loadSession: SessionLoader, api: ApiClient): RouteObject {
  const path = '/account/tokens';
  return {
    path,
    loader: guarded(loadSession, path, loadApiTokens(api)),
    action: guarded(loadSession, path, apiTokensAction(api)),
    Component: HomeInstead,
  };
}
