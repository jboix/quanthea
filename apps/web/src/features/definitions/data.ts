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

/** A definition to save, and the version the change started from (`null` for a new one). */
export interface DefinitionSave {
  readonly definition: unknown;
  readonly basedOn: number | null;
}

/** What the definitions screen submits, as JSON. */
export type DefinitionsIntent =
  | ({ readonly intent: 'save' } & DefinitionSave)
  | { readonly intent: 'saveMany'; readonly items: readonly DefinitionSave[] }
  | { readonly intent: 'delete'; readonly id: string; readonly basedOn: number };

/** How one checked body's test run went. */
export interface BodyTestView {
  readonly language: string;
  readonly connector: string;
  readonly rows: number;
}

/** How saving one of several definitions went. */
export interface SaveResult {
  /** The definition's id, as the request named it. */
  readonly id: string;
  /** Why it was refused, if it was. */
  readonly refused?: string;
}

/** What the action returns. */
export type DefinitionsOutcome =
  | { readonly ok: true; readonly id: string; readonly tests: readonly BodyTestView[] }
  | { readonly ok: true; readonly saved: readonly SaveResult[] }
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
 * The id a definition to save names, before the server checks it.
 *
 * @param definition - The definition, unchecked.
 * @returns Its id, or an empty string.
 */
function idOf(definition: unknown): string {
  const id = (definition as { id?: unknown } | null)?.id;
  return typeof id === 'string' ? id : '';
}

/**
 * Saves definitions one after the other, each on its own: a refusal leaves the others saved.
 *
 * @param api - The API client.
 * @param items - The definitions and the versions they started from.
 * @returns How each went.
 */
async function saveEach(api: ApiClient, items: readonly DefinitionSave[]): Promise<SaveResult[]> {
  const results: SaveResult[] = [];
  for (const item of items) {
    const id = idOf(item.definition);
    try {
      await api.call(saveDefinitionEndpoint, { body: item });
      results.push({ id });
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      results.push({ id, refused: error.message });
    }
  }
  return results;
}

/**
 * Runs one intent.
 *
 * @param api - The API client.
 * @param intent - The intent.
 * @returns What happened.
 */
async function run(api: ApiClient, intent: DefinitionsIntent): Promise<DefinitionsOutcome> {
  if (intent.intent === 'saveMany') return { ok: true, saved: await saveEach(api, intent.items) };
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
