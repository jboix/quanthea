/** Maps Postgres result columns to frame fields, and their values to frame values. */
import type { FieldType } from '@quanthea/shared';

/** Type OIDs whose values become numbers. `bigint` and `numeric` arrive as strings. */
const numberTypes = new Set([20, 21, 23, 26, 700, 701, 1700]);

/** Type OIDs whose values become times: date, timestamp, timestamptz. */
const timeTypes = new Set([1082, 1114, 1184]);

/** The type OID of `boolean`. */
const booleanType = 16;

/**
 * The frame type of a Postgres column.
 *
 * @param typeOid - The column's type OID, from the row description.
 * @returns `number`, `time`, `boolean`, or `string` for every other type.
 */
export function fieldTypeOf(typeOid: number): FieldType {
  if (numberTypes.has(typeOid)) return 'number';
  if (timeTypes.has(typeOid)) return 'time';
  return typeOid === booleanType ? 'boolean' : 'string';
}

/**
 * Converts a value as the driver returns it to the frame value of its field type.
 *
 * @param type - The field type, from {@link fieldTypeOf}.
 * @param value - The driver's value.
 * @returns A number, epoch milliseconds, a boolean, a string, or `null`.
 */
export function frameValue(type: FieldType, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (type === 'number') return Number(value);
  if (type === 'time') return value instanceof Date ? value.getTime() : Date.parse(String(value));
  if (type === 'boolean') return Boolean(value);
  return typeof value === 'string' ? value : JSON.stringify(value);
}
