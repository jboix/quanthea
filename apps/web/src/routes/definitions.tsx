/** The route of the definitions screen. */
import type { RouteObject } from 'react-router';
import { guarded, requireRole } from '../app/route-access.ts';
import type { SessionLoader } from '../app/session.ts';
import { definitionsAction, loadDefinitions } from '../features/definitions/index.ts';
import type { ApiClient } from '../lib/api-client.ts';

/**
 * The definitions route, for viewers. Its action saves and deletes, for editors.
 *
 * @param loadSession - Loads the current session.
 * @param api - The API client.
 * @returns The route object.
 */
export function definitionsRoute(loadSession: SessionLoader, api: ApiClient): RouteObject {
  const path = '/definitions';
  const editor = requireRole(loadSession, 'editor');
  const act = definitionsAction(api);
  return {
    path,
    loader: guarded(loadSession, path, loadDefinitions(api)),
    action: async (args) => {
      await editor(args);
      return act(args);
    },
    lazy: {
      Component: async () => (await import('../features/definitions/screens.ts')).DefinitionsScreen,
    },
  };
}
