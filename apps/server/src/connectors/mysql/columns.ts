/** Maps MySQL and MariaDB result columns to frame fields, and their values to frame values. */
import type { FieldType } from '@quanthea/shared';

/**
 * Column type codes whose values become numbers: DECIMAL, TINYINT, SMALLINT, INT, FLOAT, DOUBLE,
 * BIGINT, MEDIUMINT, YEAR and NEWDECIMAL.
 */
const numberTypes = new Set([0, 1, 2, 3, 4, 5, 8, 9, 13, 246]);

/** Column type codes whose values become times: TIMESTAMP, DATE, DATETIME. */
const timeTypes = new Set([7, 10, 12]);

/** Type names, as the catalog writes them, whose values become numbers. */
const numberTypeNames = new Set([
  'tinyint',
  'smallint',
  'mediumint',
  'int',
  'integer',
  'bigint',
  'decimal',
  'numeric',
  'float',
  'double',
  'real',
  'year',
]);

/** Type names, as the catalog writes them, whose values become times. */
const timeTypeNames = new Set(['date', 'datetime', 'timestamp']);

/**
 * The frame type of a result column.
 *
 * @param columnType - The column type code the driver reports.
 * @returns `number`, `time`, or `string` for every other type.
 */
export function fieldTypeOf(columnType: number | undefined): FieldType {
  if (columnType === undefined) return 'string';
  if (numberTypes.has(columnType)) return 'number';
  return timeTypes.has(columnType) ? 'time' : 'string';
}

/**
 * The frame type of a catalog column.
 *
 * @param dataType - The type name in `information_schema.COLUMNS.DATA_TYPE`, such as `bigint`.
 * @returns `number`, `time`, or `string` for every other type.
 */
export function fieldTypeOfName(dataType: string): FieldType {
  const name = dataType.toLowerCase();
  if (numberTypeNames.has(name)) return 'number';
  return timeTypeNames.has(name) ? 'time' : 'string';
}

/**
 * Converts a value as the driver returns it to the frame value of its field type.
 *
 * @param type - The field type, from {@link fieldTypeOf}.
 * @param value - The driver's value.
 * @returns A number, epoch milliseconds, a string, or `null`.
 */
export function frameValue(type: FieldType, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (type === 'number') return Number(value);
  if (type === 'time') return value instanceof Date ? value.getTime() : Date.parse(String(value));
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  return JSON.stringify(value);
}
