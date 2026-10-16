/**
 * Which definitions name a field a connector hides from the model: a meaning that names one on any
 * connector, or a body that uses one on a connector of its language.
 */
import {
  bodyLanguage,
  type Definition,
  type DefinitionBody,
  type DefinitionVersion,
} from '@quanthea/shared';
import { AppError } from '../lib/errors.ts';

/** A connector as definitions see it: its name, its language, and which names it hides. */
export interface DefinitionConnector {
  /** The connector's name. */
  readonly name: string;
  /** Its query language. */
  readonly language: string;
  /**
   * Whether a field, column or label name is hidden on it from the model.
   *
   * @param name - The name.
   * @returns `true` when it is hidden.
   */
  readonly isHidden: (name: string) => boolean;
}

/** The keys whose values name a field, a column or a label in a builder request. */
const fieldKeys = new Set(['field', 'column', 'by', 'time', 'series']);

/**
 * The field, column and label names a body's request holds, at any depth.
 *
 * @param value - The request, or a value inside it.
 * @returns The names.
 */
export function fieldNamesOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => fieldNamesOf(item));
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, item]) =>
    fieldKeys.has(key) && typeof item === 'string' ? [item] : fieldNamesOf(item),
  );
}

/**
 * The words of a meaning that could name a field: letters, digits, `_` and dotted paths.
 *
 * @param meaning - The meaning.
 * @returns The words.
 */
function wordsOf(meaning: string): string[] {
  // A dotted path stays whole; a full stop that ends a sentence is not part of a word.
  return (meaning.match(/[A-Za-z_][\w.]*/g) ?? []).map((word) => word.replace(/\.+$/, ''));
}

/**
 * The connector that hides a field a body uses, among those of its language.
 *
 * @param body - The body.
 * @param connectors - The connectors there are.
 * @returns The connector, if one does.
 */
function hidingBody(
  body: DefinitionBody,
  connectors: readonly DefinitionConnector[],
): DefinitionConnector | undefined {
  const names = fieldNamesOf(body.request);
  const language = bodyLanguage(body);
  return connectors.find((each) => each.language === language && names.some(each.isHidden));
}

/**
 * The connector that hides a word of a meaning, if any.
 *
 * @param meaning - The meaning.
 * @param connectors - The connectors there are.
 * @returns The connector, if one does.
 */
function hidingMeaning(
  meaning: string,
  connectors: readonly DefinitionConnector[],
): DefinitionConnector | undefined {
  const words = wordsOf(meaning);
  return connectors.find((connector) => words.some(connector.isHidden));
}

/**
 * The definitions as the model may read them, as the connectors hide fields now.
 *
 * @param versions - The latest version of each definition.
 * @param connectors - The connectors there are.
 * @returns The versions the model may read, each with the bodies it may read.
 */
export function visibleToModel(
  versions: readonly DefinitionVersion[],
  connectors: readonly DefinitionConnector[],
): DefinitionVersion[] {
  return versions.flatMap((version) => {
    const { definition } = version;
    if (hidingMeaning(definition.meaning, connectors)) return [];
    const bodies = definition.bodies.filter((body) => !hidingBody(body, connectors));
    return [{ ...version, definition: { ...definition, bodies } }];
  });
}

/**
 * Refuses a definition that names a field hidden on a connector: in a body, on the connectors of
 * its language; in its meaning, on any connector.
 *
 * @param definition - The definition.
 * @param connectors - The connectors there are.
 * @throws {AppError} `bad_request` naming the connector.
 */
export function refuseHidden(
  definition: Definition,
  connectors: readonly DefinitionConnector[],
): void {
  const meaning = hidingMeaning(definition.meaning, connectors);
  if (meaning)
    throw new AppError('bad_request', `The meaning names a field hidden on ${meaning.name}.`);
  for (const body of definition.bodies) {
    const hiding = hidingBody(body, connectors);
    if (hiding)
      throw new AppError(
        'bad_request',
        `A ${bodyLanguage(body)} body uses a field hidden on ${hiding.name}.`,
      );
  }
}
