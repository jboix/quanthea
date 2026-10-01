/**
 * The columns of an InfluxDB 3 result, whose JSON carries no types: each typed from its values,
 * and times, written in UTC without a zone, read as UTC.
 */
import type { FieldType } from '@quanthea/shared';

/** A timestamp as InfluxDB writes it: ISO 8601 in UTC, without a zone, to the nanosecond. */
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/;

/** How many rows the types are inferred from. */
const sampledRows = 100;

/**
 * The type the values of a column suggest.
 *
 * @param values - The values.
 * @returns `number`, `boolean` or `time` when every non-null value is one, else `string`.
 */
export function inferredType(values: readonly unknown[]): FieldType {
  const present = values
    .slice(0, sampledRows)
    .filter((value) => value !== null && value !== undefined);
  if (present.length === 0) return 'string';
  if (present.every((value) => typeof value === 'number')) return 'number';
  if (present.every((value) => typeof value === 'boolean')) return 'boolean';
  const times = present.every((value) => typeof value === 'string' && timestamp.test(value));
  return times ? 'time' : 'string';
}

/**
 * Converts a JSON value to the frame value of its column.
 *
 * @param type - The column type.
 * @param value - The value.
 * @returns A finite number, epoch milliseconds, a boolean, a string, or `null`.
 */
export function frameValue(type: FieldType, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (type === 'time') return timeValue(String(value));
  if (type === 'number') return finiteOrNull(Number(value));
  if (type === 'boolean') return Boolean(value);
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * A timestamp as epoch milliseconds, read in UTC when it names no zone.
 *
 * @param text - The timestamp.
 * @returns Epoch milliseconds, or `null`.
 */
function timeValue(text: string): number | null {
  return finiteOrNull(Date.parse(text.endsWith('Z') ? text : `${text.slice(0, 23)}Z`));
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

/**
 * The frame type of a column type, as `information_schema` names it.
 *
 * @param dataType - Such as `Int64`, `Timestamp(ns)` or `Dictionary(Int32, Utf8)`.
 * @returns The frame type.
 */
export function fieldTypeOfName(dataType: string): FieldType {
  if (/^Timestamp/.test(dataType)) return 'time';
  if (/^(U?Int|Float|Decimal)/.test(dataType)) return 'number';
  return dataType === 'Boolean' ? 'boolean' : 'string';
}

/**
 * How a column is stored, in InfluxDB's words.
 *
 * @param dataType - The column type.
 * @returns `tag` for a tag, `time` for the time, else the type.
 */
export function nativeTypeOf(dataType: string): string {
  if (dataType.startsWith('Dictionary')) return 'tag';
  return dataType.startsWith('Timestamp') ? 'time' : `field (${dataType})`;
}
