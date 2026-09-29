/**
 * Keeps a big connector's catalog to what the thread is about. A source with hundreds of metrics
 * would fill every request, so above a size only the entities whose names, descriptions or field
 * names share words with the person's questions are listed; `describe` reaches the rest.
 */
import { meaningfulWords, sharedWords } from '../lib/words.ts';
import type { ModelEntity } from './model-schema.ts';

/** Connectors with more entities than this are trimmed. */
const trimAbove = 40;

/** The most entities a trimmed connector lists. */
const kept = 25;

/**
 * How much an entity is about the question: its name counts double.
 *
 * @param entity - The entity.
 * @param question - The question's words.
 * @returns The score; 0 when nothing matches.
 */
function scoreOf(entity: ModelEntity, question: ReadonlySet<string>): number {
  const name = meaningfulWords(entity.name);
  const rest = meaningfulWords(
    [entity.description ?? '', ...entity.fields.map((field) => field.name)].join(' '),
  );
  return 2 * sharedWords(question, name) + sharedWords(question, rest);
}

/**
 * The entities a connector's catalog lists: all of them for a small source; for a big one, the
 * ones that best match the question, in catalog order, or the first ones when none match.
 *
 * @param entities - The connector's entities.
 * @param question - The person's questions in the thread.
 * @returns The entities to list.
 */
export function focusedEntities(
  entities: readonly ModelEntity[],
  question: string,
): readonly ModelEntity[] {
  if (entities.length <= trimAbove) return entities;
  const words = meaningfulWords(question);
  const ranked = entities
    .map((entity, index) => ({ entity, index, score: scoreOf(entity, words) }))
    .filter((entry) => entry.score > 0)
    .sort((first, second) => second.score - first.score || first.index - second.index)
    .slice(0, kept);
  if (ranked.length === 0) return entities.slice(0, kept);
  return ranked.sort((first, second) => first.index - second.index).map((entry) => entry.entity);
}
