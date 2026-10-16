/** The route of the definitions screen, with its assistant beside the definitions. */

import { hasRole } from '@quanthea/shared';
import type { RouteObject } from 'react-router';
import { ErrorPage } from '../app/error-page.tsx';
import { guarded, requireRole } from '../app/route-access.ts';
import type { SessionLoader } from '../app/session.ts';
import { definitionsAction, loadDefinitions } from '../features/definitions/index.ts';
import {
  changeThread,
  loadDefinitionAssistant,
  loadDefinitionThread,
  startDefinitionThread,
} from '../features/thread/index.ts';
import type { ApiClient } from '../lib/api-client.ts';

/**
 * The definitions route, for viewers. Its action saves and deletes, for editors. Its children are
 * the assistant, for editors: the start, which begins a conversation, and an open conversation.
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
    children: assistantRoutes(loadSession, api),
  };
}

/**
 * The assistant's routes: the start, whose loader gives others than editors nothing, and an open
 * conversation, for editors.
 *
 * @param loadSession - Loads the current session.
 * @param api - The API client.
 * @returns The child routes.
 */
function assistantRoutes(loadSession: SessionLoader, api: ApiClient): RouteObject[] {
  const chat = '/definitions/chat/:threadId';
  const mayAsk = async () => {
    const session = await loadSession();
    return session !== null && hasRole(session.principal.role, 'editor');
  };
  const editor = requireRole(loadSession, 'editor');
  const start = startDefinitionThread(api);
  return [
    {
      index: true,
      loader: guarded(loadSession, '/definitions', loadDefinitionAssistant(api, mayAsk)),
      action: async (args) => {
        await editor(args);
        return start(args);
      },
      lazy: {
        Component: async () =>
          (await import('../features/thread/screens.ts')).DefinitionAssistantStart,
      },
    },
    {
      path: 'chat/:threadId',
      loader: guarded(loadSession, chat, loadDefinitionThread(api)),
      action: guarded(loadSession, chat, changeThread(api)),
      lazy: {
        Component: async () =>
          (await import('../features/thread/screens.ts')).DefinitionAssistantChat,
      },
      ErrorBoundary: ErrorPage,
    },
  ];
}
