/** The mark a plan's panel carries when it follows a definition: checked, or from the meaning. */
import { bodyLanguage, type DefinitionVersion, type Plan } from '@quanthea/shared';

/** A plan panel's mark: its words and its tone. */
export interface DefinitionMarkView {
  readonly text: string;
  readonly tone: 'ok' | 'draft' | 'danger';
}

/**
 * The mark of a plan's panel: the definition it follows, and whether the server will copy its
 * checked filters (they exist for the panel's language) or the agent builds from the meaning.
 *
 * @param panel - The plan's panel.
 * @param definitions - The definitions there are.
 * @returns The mark, or nothing when the panel follows none.
 */
export function definitionMarkOf(
  panel: Plan['panels'][number],
  definitions: readonly DefinitionVersion[],
): DefinitionMarkView | undefined {
  if (!panel.definition) return undefined;
  const found = definitions.find((each) => each.definition.id === panel.definition);
  if (!found) return { text: `${panel.definition} · not defined`, tone: 'danger' };
  const { name, bodies } = found.definition;
  const checked = bodies.some((body) => bodyLanguage(body) === panel.language);
  return checked
    ? { text: `${name} · checked v${found.version}`, tone: 'ok' }
    : { text: `${name} · from the meaning`, tone: 'draft' };
}
