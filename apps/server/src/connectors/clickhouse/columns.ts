/** Maps ClickHouse column types to frame fields, and JSON values to frame values. */
import type { FieldType } from '@querent/shared';

/** Numeric types: integers of every width, floats and decimals. */
const numberType = /^(?:U?Int\d+|Float\d+|BFloat16|Decimal\d*)(?:\(.*\))?$/;

/** Date and time types, with or without a precision and a time zone. */
const timeType = /^(?:Date|Date32|DateTime|DateTime64)(?:\(.*\))?$/;

/**
 * A type without the wrappers that do not change its values: `Nullable` and `LowCardinality`.
 *
 * @param type - The type, such as `LowCardinality(Nullable(String))`.
 * @returns The inner type, such as `String`.
 */
export function innerType(type: string): string {
  const wrapped = /^(?:Nullable|LowCardinality)\((.*)\)$/.exec(type.trim());
  return wrapped?.[1] === undefined ? type.trim() : innerType(wrapped[1]);
}

/**
 * The frame type of a column.
 *
 * @param type - The ClickHouse type, as a result or `system.columns` names it.
 * @returns `number`, `time`, `boolean`, or `string` for every other type.
 */
export function fieldTypeOf(type: string): FieldType {
  const inner = innerType(type);
  if (numberType.test(inner)) return 'number';
  if (timeType.test(inner)) return 'time';
  return inner === 'Bool' ? 'boolean' : 'string';
}

/**
 * Converts a JSON value, as ClickHouse writes it with ISO times and unquoted numbers, to the frame
 * value of its field type.
 *
 * @param type - The field type, from {@link fieldTypeOf}.
 * @param value - The JSON value. NaN and infinities arrive as `null`.
 * @returns A number, epoch milliseconds, a boolean, a string, or `null`.
 */
export function frameValue(type: FieldType, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (type === 'number') return Number(value);
  if (type === 'time') return Date.parse(String(value));
  if (type === 'boolean') return Boolean(value);
  return typeof value === 'string' ? value : JSON.stringify(value);
}
