/**
 * One turn in a definition thread: its instructions and its tools. The instructions carry what
 * lasts first (who the agent is there, its rules, the query builders, the catalog), then the
 * turn's facts: the time and the definitions there are.
 */
import { resolveTime } from '@quanthea/shared';
import type { Instructions } from 'ai';
import { askPersonTool } from './ask-tool.ts';
import { cachedInstructions } from './cache.ts';
import { dataTools } from './data-tools.ts';
import { definitionsTopic } from './definition-facts.ts';
import { definitionPersona, definitionRules } from './definition-prompt.ts';
import { proposeDefinitionsTool } from './definition-tools.ts';
import { guideTools } from './guide-tools.ts';
import { builderSection } from './panel-guide.ts';
import { nowLine } from './prompt.ts';
import type { RunContext } from './run-context.ts';
import { catalogSection } from './source-text.ts';

/**
 * The query builders a body may use, or why there are none.
 *
 * @param context - The run.
 * @returns The lines.
 */
function builderLines(context: RunContext): string[] {
  const lines = builderSection(context.queries.builtIn);
  if (lines.length === 0)
    return ['No query builder fits these connectors: propose meanings only, with no bodies.'];
  return ['The builders a body may use, with what each returns:', ...lines];
}

/**
 * The definitions there are, as the model may read them, in the turn's facts.
 *
 * @param context - The run.
 * @returns The lines.
 */
function definedLines(context: RunContext): string {
  if (context.definitions.length === 0) return 'Definitions so far: none.';
  return `Definitions so far, which a proposal with the same id changes:\n${definitionsTopic(context.definitions).text}`;
}

/**
 * The instructions of a turn in a definition thread.
 *
 * @param context - The run.
 * @param hints - The person's time zone.
 * @param now - The current instant.
 * @param questions - The person's messages, which trim big connectors' catalogs.
 * @returns The instructions, split for the provider's cache.
 */
export async function definitionInstructions(
  context: RunContext,
  hints: { readonly timeZone?: string | undefined },
  now: number,
  questions: string,
): Promise<Instructions> {
  const catalog = await context.modelView.catalog(context.signal, questions);
  const lasting = [
    definitionPersona,
    definitionRules,
    ...builderLines(context),
    catalogSection(catalog),
  ];
  const facts = [nowLine(now, hints.timeZone), definedLines(context)];
  const parts = { lasting: lasting.join('\n\n'), turn: facts.join('\n\n') };
  return cachedInstructions(parts, context.settings.provider);
}

/**
 * Every tool of a definition thread.
 *
 * @param context - The run.
 * @param now - The clock.
 * @returns The tools.
 */
export function definitionTurnTools(context: RunContext, now: () => number) {
  return {
    ...dataTools(context, (expression) => resolveTime(expression, now())),
    ...guideTools(context.modelView.guides()),
    propose_definitions: proposeDefinitionsTool(context),
    ask_person: askPersonTool(context),
  };
}
