/**
 * The agent's way to propose definitions of business terms. Each is checked as a save would check
 * it and its bodies test-run, saving nothing; those that pass stream a card, and only the person's
 * click on the card saves one. The model learns what failed and, as its access level allows,
 * whether each body found rows.
 */
import {
  type DefinitionProposals,
  definitionIdSchema,
  definitionShapes,
  maxMeaningLength,
} from '@quanthea/shared';
import { tool } from 'ai';
import { z } from 'zod';
import type { CheckedDefinition } from '../dashboards/definitions.ts';
import { bodyRequestSchemaFor } from '../dashboards/queries/index.ts';
import { modelRowsFound } from '../gate/test-run.ts';
import type { RunContext } from './run-context.ts';
import { providerSchema } from './tool-schema.ts';

/** The most definitions one call proposes. */
const maxProposals = 10;

/**
 * The input of `propose_definitions`, with the builders the run may use.
 *
 * @param builders - The builders' kinds.
 * @returns The schema.
 */
function proposalsSchema(builders: readonly string[]) {
  const body = z.strictObject({
    shape: z.enum(definitionShapes),
    request: bodyRequestSchemaFor(builders),
    connectors: z.array(z.string().min(1).max(63)).min(1).max(20).optional(),
  });
  const definition = z.strictObject({
    id: definitionIdSchema,
    name: z.string().trim().min(1).max(80),
    synonyms: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
    meaning: z.string().trim().min(1).max(maxMeaningLength),
    bodies: z.array(body).max(5).default([]),
  });
  return z.strictObject({ definitions: z.array(definition).min(1).max(maxProposals) });
}

/** One proposal after its check: passed, or refused with why. */
type Checked =
  | { readonly ok: true; readonly checked: CheckedDefinition }
  | { readonly ok: false; readonly id: string; readonly problem: string };

/**
 * Checks one proposal as a save would, saving nothing.
 *
 * @param context - The run.
 * @param definition - The proposal.
 * @returns It checked, or why not.
 */
async function checkOne(
  context: RunContext,
  definition: { readonly id: string },
): Promise<Checked> {
  if (!context.checkDefinition)
    return { ok: false, id: definition.id, problem: 'Definitions are not available here.' };
  try {
    return { ok: true, checked: await context.checkDefinition(definition) };
  } catch (error) {
    const problem = error instanceof Error ? error.message : 'The check failed.';
    return { ok: false, id: definition.id, problem };
  }
}

/**
 * What the model learns of a checked proposal: whether it is new or changes a version, and how
 * each body's test went as its connector's access level allows.
 *
 * @param context - The run.
 * @param checked - The proposal, checked.
 * @returns The line.
 */
function modelLine(context: RunContext, checked: CheckedDefinition): string {
  const levels = new Map(
    context.modelView.connectors().map((each) => [each.name, each.accessLevel]),
  );
  const tests = checked.tests.map(
    (test) =>
      `${test.language} on ${test.connector} ${modelRowsFound(levels.get(test.connector) ?? 1, test.rows)}`,
  );
  const change = checked.latest === null ? 'new' : `changes v${checked.latest}`;
  const body = tests.length === 0 ? 'meaning only' : tests.join(', ');
  return `${checked.definition.id} (${change}): ${body}`;
}

/**
 * The tool that proposes definitions for the person to save.
 *
 * @param context - The run.
 * @returns The tool.
 */
export function proposeDefinitionsTool(context: RunContext) {
  return tool({
    description:
      'Propose definitions of business terms, up to 10 in one call: each with its id, name, synonyms, meaning and checked filters. Each is checked and its filters test-run over the last day, saving nothing. Those that pass show the person a card where they save each one; nothing is saved until they do. Returns what passed and what failed, with why.',
    inputSchema: providerSchema(proposalsSchema(context.queries.builtIn)),
    execute: async ({ definitions }) => {
      const results = await Promise.all(definitions.map((each) => checkOne(context, each)));
      const passed = results.flatMap((each) => (each.ok ? [each.checked] : []));
      const failed = results.flatMap((each) =>
        each.ok ? [] : [{ id: each.id, problem: each.problem }],
      );
      const proposals: DefinitionProposals['proposals'] = passed.map((each) => ({
        definition: each.definition,
        latest: each.latest,
        tests: [...each.tests],
      }));
      if (proposals.length > 0)
        context.writer.write({ type: 'data-definitionProposals', data: { proposals } });
      const next =
        failed.length > 0
          ? 'Fix the failed ones and propose only those again.'
          : 'The person saves them from the card. Say in one sentence what you proposed, then stop.';
      return { proposed: passed.map((each) => modelLine(context, each)), failed, next };
    },
  });
}
