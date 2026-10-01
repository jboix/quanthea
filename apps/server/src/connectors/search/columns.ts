/** Maps Elasticsearch and OpenSearch field types to frame fields, and document values to frame values. */
import type { FieldType } from '@quanthea/shared';

/** Numeric field types. */
const numberTypes = new Set([
  'long',
  'integer',
  'short',
  'byte',
  'double',
  'float',
  'half_float',
  'scaled_float',
  'unsigned_long',
  'token_count',
]);

/** A mapping's properties: field name to its mapping. */
type Properties = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

/**
 * The frame type of a field type.
 *
 * @param type - The mapping type, such as `keyword` or `date`.
 * @returns `number`, `time`, `boolean`, or `string` for every other type.
 */
export function fieldTypeOf(type: string | undefined): FieldType {
  if (type === undefined) return 'string';
  if (numberTypes.has(type)) return 'number';
  if (type === 'date' || type === 'date_nanos') return 'time';
  return type === 'boolean' ? 'boolean' : 'string';
}

/**
 * The fields of a mapping, by their dotted path: objects and nested fields walked, multi-fields
 * such as `message.keyword` included.
 *
 * @param properties - The `properties` of a mapping.
 * @param into - Where to add the fields, by path.
 * @param prefix - The path of the enclosing object.
 * @returns `into`.
 */
export function mappingFields(
  properties: unknown,
  into: Map<string, string> = new Map(),
  prefix = '',
): Map<string, string> {
  const entries = Object.entries((properties ?? {}) as Properties);
  for (const [name, field] of entries) {
    const path = `${prefix}${name}`;
    if (typeof field.type === 'string') into.set(path, field.type);
    if (field.properties) mappingFields(field.properties, into, `${path}.`);
    if (field.fields) mappingFields(field.fields, into, `${path}.`);
  }
  return into;
}

/**
 * Converts a document value to the frame value of its field type.
 *
 * @param type - The field type, from {@link fieldTypeOf}.
 * @param value - The value from `_source` or a bucket key.
 * @returns A finite number, epoch milliseconds, a boolean, a string, or `null`.
 */
export function frameValue(type: FieldType, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (type === 'time') return timeValue(value);
  if (type === 'number') return finiteOrNull(Number(value));
  if (type === 'boolean') return value === true || value === 'true';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * A date as epoch milliseconds: a number is already one, text is parsed.
 *
 * @param value - The value.
 * @returns Epoch milliseconds, or `null` when it is not a date.
 */
function timeValue(value: unknown): number | null {
  return finiteOrNull(typeof value === 'number' ? value : Date.parse(String(value)));
}

/**
 * A number, or `null` for NaN and the infinities.
 *
 * @param value - The number.
 * @returns The number or `null`.
 */
function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}
