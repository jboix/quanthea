/** Loads, saves and deletes definitions through the API. */
import {
  type DefinitionVersion,
  deleteDefinitionEndpoint,
  listDefinitionsEndpoint,
  saveDefinitionEndpoint,
} from '@quanthea/shared';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';

/** What the definitions screen shows. */
export interface DefinitionsData {
  /** The latest version of each definition. */
  readonly definitions: readonly DefinitionVersion[];
  /** The file that declares each definition the configuration file manages, by id. */
  readonly managed: Readonly<Record<string, string>>;
}

/** What the definitions screen submits, as JSON. */
export type DefinitionsIntent =
  | { readonly intent: 'save'; readonly definition: unknown; readonly basedOn: number | null }
  | { readonly intent: 'delete'; readonly id: string; readonly basedOn: number };

/** How one checked body's test run went. */
export interface BodyTestView {
  readonly language: string;
  readonly connector: string;
  readonly rows: number;
}

/** What the action returns. */
export type DefinitionsOutcome =
  | { readonly ok: true; readonly id: string; readonly tests: readonly BodyTestView[] }
  | { readonly ok: false; readonly message: string };

/**
 * The loader of the definitions screen.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadDefinitions(api: ApiClient) {
  return ({ request }: LoaderFunctionArgs): Promise<DefinitionsData> =>
    api.call(listDefinitionsEndpoint, undefined, { signal: request.signal });
}

/**
 * Runs one intent.
 *
 * @param api - The API client.
 * @param intent - The intent.
 * @returns What happened.
 */
async function run(api: ApiClient, intent: DefinitionsIntent): Promise<DefinitionsOutcome> {
  if (intent.intent === 'delete') {
    const params = { definitionId: intent.id };
    await api.call(deleteDefinitionEndpoint, { params, body: { basedOn: intent.basedOn } });
    return { ok: true, id: intent.id, tests: [] };
  }
  const body = { definition: intent.definition, basedOn: intent.basedOn };
  const saved = await api.call(saveDefinitionEndpoint, { body });
  return { ok: true, id: saved.version.definition.id, tests: saved.tests };
}

/**
 * The action of the definitions screen: save or delete one, for editors. A refusal comes back as
 * its message, to show beside the form.
 *
 * @param api - The API client.
 * @returns The action.
 */
export function definitionsAction(api: ApiClient) {
  return async ({ request }: ActionFunctionArgs): Promise<DefinitionsOutcome> => {
    try {
      return await run(api, (await request.json()) as DefinitionsIntent);
    } catch (error) {
      if (
        !(error instanceof ApiError) ||
        !['bad_request', 'conflict', 'forbidden'].includes(error.code)
      )
        throw error;
      return { ok: false, message: error.message };
    }
  };
}
