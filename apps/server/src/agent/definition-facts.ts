/**
 * What the agent reads of the definitions: an index in its instructions, so it follows what the
 * team means by a word instead of reading it literally; the whole of each in a guide; and a note
 * on a written panel that names a defined term without using its definition.
 */
import { bodyLanguage, type DefinitionVersion, type Panel } from '@quanthea/shared';

/** The most characters the index of definitions takes in the instructions. */
export const definitionIndexBudget = 2500;

/** How the agent uses definitions, said once above the index. */
const definitionRule = `Definitions: what the team means by these terms. When the person uses one, or a synonym, follow its meaning: never read the word literally. Name it in the plan's panel ("definition": its id). Where it has checked filters for the panel's language, build the panel with data { "kind": "definition", "id", "builder", "connector", "filters"?, "options"? }: the server copies the filters, and options hold how the panel presents them (by, over, limit, bucket, time). Elsewhere build from its meaning with your own filters, and say so in the panel's description. A term that sounds defined but is not here: ask what it means rather than guess.`;

/**
 * Where a definition has checked filters, in words.
 *
 * @param version - The definition's version.
 * @returns Such as `checked: search (ratio)`, or `meaning only`.
 */
function checkedIn(version: DefinitionVersion): string {
  const bodies = version.definition.bodies.map((body) => `${bodyLanguage(body)} (${body.shape})`);
  return bodies.length === 0 ? 'meaning only' : `checked: ${bodies.join(', ')}`;
}

/**
 * One definition's line: its id, name, synonyms, meaning and where it is checked.
 *
 * @param version - The definition's version.
 * @returns The line.
 */
function lineOf(version: DefinitionVersion): string {
  const { id, name, synonyms, meaning } = version.definition;
  const also = synonyms.length > 0 ? ` (also: ${synonyms.join(', ')})` : '';
  return `- ${id} "${name}"${also}: ${meaning} [${checkedIn(version)}]`;
}

/**
 * The definitions section of the instructions: the rule and a line per definition, or only their
 * names and a pointer to the guide once the lines pass the budget.
 *
 * @param definitions - The definitions the model may read.
 * @returns The section, or nothing when there are none.
 */
export function definitionsSection(definitions: readonly DefinitionVersion[]): string | undefined {
  if (definitions.length === 0) return undefined;
  const lines = definitions.map(lineOf);
  if (lines.join('\n').length <= definitionIndexBudget)
    return [definitionRule, ...lines].join('\n');
  const names = definitions.map(({ definition }) => `${definition.id} "${definition.name}"`);
  return `${definitionRule}\nThe definitions: ${names.join(', ')}. Read their meanings with read_guide: { "kind": "definitions" } before you plan.`;
}

/**
 * The definitions guide: every definition's line, whatever the budget.
 *
 * @param definitions - The definitions the model may read.
 * @returns The guide, for read_guide.
 */
export function definitionsTopic(definitions: readonly DefinitionVersion[]) {
  return { kind: 'definitions', text: [definitionRule, ...definitions.map(lineOf)].join('\n') };
}

/**
 * Whether a text names a term, as a whole word or words, without case.
 *
 * @param text - The text.
 * @param term - The term.
 * @returns Whether it does.
 */
function names(text: string, term: string): boolean {
  const escaped = term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\W)${escaped}(\\W|$)`).test(text.toLowerCase());
}

/**
 * Notes on written panels whose title names a defined term but whose data was not copied from it.
 * The panel is kept: a note, never a refusal.
 *
 * @param panels - The panels the edit wrote.
 * @param definitions - The definitions the model may read.
 * @returns The notes.
 */
export function ignoredDefinitionNotes(
  panels: readonly Panel[],
  definitions: readonly DefinitionVersion[],
): string[] {
  return panels.flatMap((panel) => {
    if (panel.definition) return [];
    const ignored = definitions.find(({ definition }) =>
      [definition.name, ...definition.synonyms].some((term) => names(panel.title, term)),
    );
    if (!ignored) return [];
    const { id, name } = ignored.definition;
    return [
      `"${panel.title}" names ${name} but does not use the definition ${id}. Rebuild it from the definition, or say in its description why not.`,
    ];
  });
}
