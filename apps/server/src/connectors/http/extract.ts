/**
 * Turns a JSON response into a table: the rows a JSON pointer names, and a column per field the
 * query names, or per value the rows hold, nested ones as dotted names. Nothing here runs code
 * from the query: pointers and types are data.
 */
import type { FieldType, Frame } from '@quanthea/shared';
import {
  ConnectorError,
  createFrameBuilder,
  type ExecutionContext,
  type HttpField,
  type HttpQuery,
} from '../_shared/index.ts';

/** How many rows the columns are inferred from. */
const sampledRows = 100;

/** The most columns an inferred table gets. */
const maxColumns = 50;

/** An ISO 8601 date or date-time. */
const isoTime =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Reads a JSON pointer (RFC 6901).
 *
 * @param document - The document.
 * @param pointer - Such as `/data/items`; empty for the whole document.
 * @returns The value there, or `undefined`.
 */
export function atPointer(document: unknown, pointer: string): unknown {
  if (pointer === '') return document;
  const tokens = pointer
    .slice(1)
    .split('/')
    .map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'));
  let value: unknown = document;
  for (const token of tokens) {
    if (value === null || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[token];
  }
  return value;
}

/**
 * The rows a pointer names: an array, or one object as one row.
 *
 * @param document - The response.
 * @param pointer - Where the rows are.
 * @returns The rows.
 * @throws {ConnectorError} `rejected` when the pointer names no array or object.
 */
function rowsOf(document: unknown, pointer: string): unknown[] {
  const value = atPointer(document, pointer);
  if (Array.isArray(value)) return value;
  if (value !== null && typeof value === 'object') return [value];
  throw new ConnectorError(
    'rejected',
    `The response has no rows at "${pointer || '/'}": point extract.rows at an array.`,
  );
}

/**
 * The pointers of every value a row holds, objects walked to dotted names, arrays kept whole.
 *
 * @param row - The row.
 * @param prefix - The pointer of the enclosing object.
 * @param into - Where the pointers go.
 * @returns `into`.
 */
function leafPointers(row: unknown, prefix = '', into: Set<string> = new Set()): Set<string> {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) {
    into.add(prefix);
    return into;
  }
  for (const [key, value] of Object.entries(row))
    leafPointers(value, `${prefix}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`, into);
  return into;
}

/**
 * The type the values of a column suggest.
 *
 * @param values - The values.
 * @returns `number`, `boolean` or `time` when every non-null value is one, else `string`.
 */
function inferredType(values: readonly unknown[]): FieldType {
  const present = values.filter((value) => value !== null && value !== undefined);
  if (present.length === 0) return 'string';
  if (present.every((value) => typeof value === 'number')) return 'number';
  if (present.every((value) => typeof value === 'boolean')) return 'boolean';
  const times = present.every((value) => typeof value === 'string' && isoTime.test(value));
  return times ? 'time' : 'string';
}

/**
 * The columns of rows the query names none of: every value of the first rows.
 *
 * @param rows - The rows.
 * @returns The fields, each typed from its values.
 */
export function inferredFields(rows: readonly unknown[]): HttpField[] {
  const sample = rows.slice(0, sampledRows);
  const pointers = new Set<string>();
  for (const row of sample) leafPointers(row, '', pointers);
  return [...pointers].slice(0, maxColumns).map((pointer) => ({
    name:
      pointer === ''
        ? 'value'
        : pointer.slice(1).replaceAll('/', '.').replaceAll('~1', '/').replaceAll('~0', '~'),
    pointer,
    type: inferredType(sample.map((row) => atPointer(row, pointer))),
  }));
}

/**
 * Converts a value to the frame value of its column.
 *
 * @param field - The column.
 * @param value - The value.
 * @returns A finite number, epoch milliseconds, a boolean, a string, or `null`.
 */
export function cellValue(field: HttpField, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (field.type === 'time') return timeValue(value, field.unit);
  if (field.type === 'number') return finiteOrNull(Number(value));
  if (field.type === 'boolean') return value === true || value === 'true';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * A time as epoch milliseconds: text parsed, a number read in its unit.
 *
 * @param value - The value.
 * @param unit - Seconds or milliseconds, for a number; milliseconds by default.
 * @returns Epoch milliseconds, or `null`.
 */
function timeValue(value: unknown, unit: HttpField['unit']): number | null {
  if (typeof value === 'number') return finiteOrNull(unit === 's' ? value * 1000 : value);
  return finiteOrNull(Date.parse(String(value)));
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
 * The table of a response.
 *
 * @param document - The parsed response.
 * @param extract - Where the rows are, and the columns.
 * @param context - The execution context.
 * @param durationMs - How long the request took.
 * @returns The frame.
 * @throws {ConnectorError} `rejected` when the rows are not where the query says.
 */
export function responseFrame(
  document: unknown,
  extract: HttpQuery['extract'],
  context: ExecutionContext,
  durationMs: number,
): Frame {
  const rows = rowsOf(document, extract.rows);
  const fields = extract.fields?.length ? extract.fields : inferredFields(rows);
  const typed = fields.map((field) => ({
    ...field,
    type:
      field.type ??
      inferredType(rows.slice(0, sampledRows).map((row) => atPointer(row, field.pointer))),
  }));
  const builder = createFrameBuilder({
    refId: context.refId,
    fields: typed.map((field) => ({ name: field.name, type: field.type })),
    maxRows: context.maxRows,
  });
  for (const row of rows) {
    if (!builder.add(typed.map((field) => cellValue(field, atPointer(row, field.pointer))))) break;
  }
  return builder.build(durationMs);
}
