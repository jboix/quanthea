/**
 * Keeps a big connector's catalog to what the thread is about. A source with hundreds of metrics
 * would fill every request, so above a size only the entities whose names, descriptions or field
 * names share words with the person's questions are listed; `describe` reaches the rest.
 */
import type { ModelEntity } from './model-schema.ts';

/** Connectors with more entities than this are trimmed. */
const trimAbove = 40;

/** The most entities a trimmed connector lists. */
const kept = 25;

/** Words that say nothing about which data a question is about. */
const stopWords: ReadonlySet<string> = new Set(
  'the and for with what how show from that this are was per all any can you want see over time last day yesterday today hour hours week dashboard panel chart graph around happened'.split(
    ' ',
  ),
);

/**
 * A word's plain form, so `errors` finds `error`.
 *
 * @param word - The word, lowercase.
 * @returns The word without a plural s.
 */
function stem(word: string): string {
  return word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word;
}

/**
 * The meaningful words of a text or a name, `http_requests_total` giving `http`, `request`, `total`.
 *
 * @param text - The text.
 * @returns The words.
 */
function wordsOf(text: string): Set<string> {
  const words = text.toLowerCase().split(/[^a-z0-9]+/);
  return new Set(words.filter((word) => word.length >= 3 && !stopWords.has(word)).map(stem));
}

/**
 * How much an entity is about the question: its name counts double.
 *
 * @param entity - The entity.
 * @param question - The question's words.
 * @returns The score; 0 when nothing matches.
 */
function scoreOf(entity: ModelEntity, question: ReadonlySet<string>): number {
  const name = wordsOf(entity.name);
  const rest = wordsOf(
    [entity.description ?? '', ...entity.fields.map((field) => field.name)].join(' '),
  );
  let score = 0;
  for (const word of question) score += (name.has(word) ? 2 : 0) + (rest.has(word) ? 1 : 0);
  return score;
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
  const words = wordsOf(question);
  const ranked = entities
    .map((entity, index) => ({ entity, index, score: scoreOf(entity, words) }))
    .filter((entry) => entry.score > 0)
    .sort((first, second) => second.score - first.score || first.index - second.index)
    .slice(0, kept);
  if (ranked.length === 0) return entities.slice(0, kept);
  return ranked.sort((first, second) => first.index - second.index).map((entry) => entry.entity);
}
