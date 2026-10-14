/** The definition endpoints: every role reads them; editors and admins save and delete them. */
import {
  definitionHistoryEndpoint,
  deleteDefinitionEndpoint,
  listDefinitionsEndpoint,
  saveDefinitionEndpoint,
} from '@quanthea/shared';
import type { Hono } from 'hono';
import type { Definitions } from '../../dashboards/definitions.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { actorOf } from '../principal.ts';

/**
 * Mounts the definition endpoints.
 *
 * @param app - The app.
 * @param services - The services.
 * @param services.definitions - The definitions.
 */
export function mountDefinitionEndpoints(
  app: Hono<AppEnv>,
  { definitions }: { readonly definitions: Definitions },
): void {
  mountEndpoint(app, listDefinitionsEndpoint, {
    access: 'viewer',
    handle: () => ({ definitions: definitions.list() }),
  });
  mountEndpoint(app, definitionHistoryEndpoint, {
    access: 'viewer',
    handle: ({ params }) => ({ versions: definitions.history(params.definitionId) }),
  });
  mountEndpoint(app, saveDefinitionEndpoint, {
    access: 'editor',
    handle: ({ body, principal }) =>
      definitions.save(body.definition, body.basedOn, actorOf(principal)),
  });
  mountEndpoint(app, deleteDefinitionEndpoint, {
    access: 'editor',
    handle: ({ params, body, principal }) => {
      definitions.remove(params.definitionId, body.basedOn, actorOf(principal));
      return { deleted: true as const };
    },
  });
}
