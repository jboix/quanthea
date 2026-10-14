/**
 * Definition endpoints: every role reads the definitions; editors and admins save and delete them.
 * A save checks the definition and test-runs each body, and says how many rows each found.
 */
import { z } from 'zod';
import { definitionIdSchema, definitionVersionSchema } from '../definitions.ts';
import { defineEndpoint } from './contract.ts';

/** The definition named in a path. */
const definitionParams = z.object({ definitionId: definitionIdSchema });

/**
 * Lists the latest version of every definition, and the file that declares each one the
 * configuration file manages: those are read-only.
 */
export const listDefinitionsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/definitions',
  output: z.object({
    definitions: z.array(definitionVersionSchema),
    managed: z.record(z.string(), z.string()),
  }),
});

/** Lists every version of a definition, the latest first. */
export const definitionHistoryEndpoint = defineEndpoint({
  method: 'GET',
  path: '/definitions/:definitionId/history',
  params: definitionParams,
  output: z.object({ versions: z.array(definitionVersionSchema) }),
});

/** How one body's test run went. */
export const bodyTestSchema = z.object({
  language: z.string(),
  connector: z.string(),
  /** How many rows it found; zero is worth a look. */
  rows: z.int().min(0),
});

/**
 * Saves a definition as its next version. `basedOn` is the version the change started from, or
 * `null` for a new definition; another version saved since refuses it.
 */
export const saveDefinitionEndpoint = defineEndpoint({
  method: 'POST',
  path: '/definitions',
  body: z.object({ definition: z.unknown(), basedOn: z.int().min(1).nullable() }),
  output: z.object({ version: definitionVersionSchema, tests: z.array(bodyTestSchema) }),
});

/** Deletes a definition. Panels built from it keep their copy. */
export const deleteDefinitionEndpoint = defineEndpoint({
  method: 'POST',
  path: '/definitions/:definitionId/delete',
  params: definitionParams,
  body: z.object({ basedOn: z.int().min(1) }),
  output: z.object({ deleted: z.literal(true) }),
});
