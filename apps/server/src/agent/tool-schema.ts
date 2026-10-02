/**
 * A tool's input schema as providers receive it. Gemini refuses a forced tool call whose schema
 * bounds the length of arrays (`minItems`, `maxItems`) in a large schema: its constrained decoder
 * grows past its limit. The model sees the schema without those bounds; the input is still
 * checked against the whole schema.
 */
import { type JSONSchema7, jsonSchema, type Schema, zodSchema } from 'ai';
import type { z } from 'zod';

/** The keywords whose value maps names to schemas, so its keys are names, not keywords. */
const schemaMaps = new Set(['properties', '$defs', 'definitions', 'patternProperties']);

/**
 * A part of a JSON schema without array length bounds, at every depth.
 *
 * @param value - A schema, or a value inside one.
 * @param keysAreNames - Whether the value's keys are names, such as a schema's `properties`.
 * @returns The value without `minItems` and `maxItems`.
 */
export function withoutItemBounds(value: unknown, keysAreNames = false): unknown {
  if (Array.isArray(value)) return value.map((item) => withoutItemBounds(item));
  if (typeof value !== 'object' || value === null) return value;
  const kept = Object.entries(value).filter(
    ([key]) => keysAreNames || (key !== 'minItems' && key !== 'maxItems'),
  );
  return Object.fromEntries(
    kept.map(([key, item]) => [key, withoutItemBounds(item, !keysAreNames && schemaMaps.has(key))]),
  );
}

/**
 * A tool input schema for the providers: the Zod schema's JSON schema without array bounds, and
 * the Zod schema's own validation.
 *
 * @param schema - The Zod schema.
 * @returns The schema for `tool({ inputSchema })`.
 */
export function providerSchema<OBJECT>(schema: z.ZodType<OBJECT>): Schema<OBJECT> {
  const whole = zodSchema(schema);
  return jsonSchema<OBJECT>(async () => withoutItemBounds(await whole.jsonSchema) as JSONSchema7, {
    validate: (value) => whole.validate?.(value) ?? { success: true, value: value as OBJECT },
  });
}
