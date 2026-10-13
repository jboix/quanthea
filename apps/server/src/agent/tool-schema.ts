/**
 * A tool's input schema as providers receive it: the Zod schema's JSON schema, made smaller.
 * Gemini refuses a forced tool call whose schema is large: its constrained decoder grows past its
 * limit. So the model sees the schema without what the server checks or fills by itself (the
 * bounds of arrays and texts, default values, the ban on unknown fields), and with the query
 * languages of the connectors in use only. The input is still checked against the whole schema.
 */
import { type JSONSchema7, jsonSchema, type Schema, zodSchema } from 'ai';
import type { z } from 'zod';

/** The keywords whose value maps names to schemas, so its keys are names, not keywords. */
const schemaMaps = new Set(['properties', '$defs', 'definitions', 'patternProperties']);

/** The keywords the server checks or fills by itself, which the model does not need. */
const dropped = new Set(['minItems', 'maxItems', 'minLength', 'maxLength', 'default']);

/** The keywords that list alternatives. */
const alternatives = new Set(['oneOf', 'anyOf']);

/**
 * Whether a keyword stays in the schema the model sees.
 *
 * @param key - The keyword.
 * @param value - Its value.
 * @returns `false` for a bound, a default, and the ban on unknown fields.
 */
function kept(key: string, value: unknown): boolean {
  return !dropped.has(key) && !(key === 'additionalProperties' && value === false);
}

/**
 * The query language an alternative is for, when it is a form of one language.
 *
 * @param alternative - One alternative of a `oneOf` or an `anyOf`.
 * @returns The language, or `undefined` when the alternative names none.
 */
function languageOf(alternative: unknown): string | undefined {
  const language = (alternative as { properties?: { language?: { const?: unknown } } })?.properties
    ?.language?.const;
  return typeof language === 'string' ? language : undefined;
}

/**
 * The alternatives a run offers: where each is the form of one query language, those of the
 * languages in use.
 *
 * @param list - The alternatives.
 * @param languages - The languages in use; every one when not given.
 * @returns The alternatives kept, all of them when none is in use.
 */
function offered(list: readonly unknown[], languages: ReadonlySet<string> | undefined) {
  if (!languages || list.some((each) => languageOf(each) === undefined)) return list;
  const inUse = list.filter((each) => languages.has(languageOf(each) ?? ''));
  return inUse.length === 0 ? list : inUse;
}

/**
 * A part of a JSON schema as the model sees it, at every depth.
 *
 * @param value - A schema, or a value inside one.
 * @param languages - The query languages in use; every one when not given.
 * @param keysAreNames - Whether the value's keys are names, such as a schema's `properties`.
 * @returns The value, smaller.
 */
export function trimmed(
  value: unknown,
  languages?: ReadonlySet<string>,
  keysAreNames = false,
): unknown {
  if (Array.isArray(value)) return value.map((item) => trimmed(item, languages));
  if (typeof value !== 'object' || value === null) return value;
  const entries = Object.entries(value).filter(([key, item]) => keysAreNames || kept(key, item));
  return Object.fromEntries(
    entries.map(([key, item]) => {
      const list = !keysAreNames && alternatives.has(key) && Array.isArray(item);
      const inner = list ? offered(item, languages) : item;
      return [key, trimmed(inner, languages, !keysAreNames && schemaMaps.has(key))];
    }),
  );
}

/**
 * A tool input schema for the providers: the Zod schema's JSON schema made smaller, and the Zod
 * schema's own validation.
 *
 * @param schema - The Zod schema.
 * @param languages - The query languages of the connectors in use; every one when not given.
 * @returns The schema for `tool({ inputSchema })`.
 */
export function providerSchema<OBJECT>(
  schema: z.ZodType<OBJECT>,
  languages?: readonly string[],
): Schema<OBJECT> {
  const whole = zodSchema(schema);
  const inUse = languages ? new Set(languages) : undefined;
  return jsonSchema<OBJECT>(async () => trimmed(await whole.jsonSchema, inUse) as JSONSchema7, {
    validate: (value) => whole.validate?.(value) ?? { success: true, value: value as OBJECT },
  });
}
