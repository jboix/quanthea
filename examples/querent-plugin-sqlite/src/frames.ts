/**
 * Turns the rows SQLite returns into a frame: a column per result column, typed from its declared
 * type, else from its values. Times are ISO 8601 text, the way SQLite keeps them.
 */
import type { ConnectorKit, ExecutionContext, Field, FieldType, Frame } from '@querent/plugin-kit';

/** An ISO 8601 date or date-time. */
const isoTime =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * The frame type of a declared SQLite type, by its affinity.
 *
 * @param declared - Such as `INTEGER`, `REAL`, `TEXT` or `DATETIME`, if any.
 * @returns The type, or `undefined` when the values decide.
 */
export function typeOfDeclared(declared: string | null | undefined): FieldType | undefined {
  const type = (declared ?? '').toUpperCase();
  if (/DATE|TIME/.test(type)) return 'time';
  if (/BOOL/.test(type)) return 'boolean';
  if (/INT|REAL|FLOA|DOUB|NUM|DEC/.test(type)) return 'number';
  return type === '' ? undefined : 'string';
}

/**
 * The type the values of a column suggest.
 *
 * @param values - The values.
 * @returns `number` or `time` when every present value is one, else `string`.
 */
function typeOfValues(values: readonly unknown[]): FieldType {
  const present = values.filter((value) => value !== null && value !== undefined);
  if (present.length > 0 && present.every((value) => typeof value === 'number')) return 'number';
  const times = present.every((value) => typeof value === 'string' && isoTime.test(value));
  return present.length > 0 && times ? 'time' : 'string';
}

/**
 * A time as epoch milliseconds: a number as it is, ISO text parsed.
 *
 * @param value - The value.
 * @returns Milliseconds, or `null`.
 */
function timeOf(value: unknown): number | null {
  const time = typeof value === 'number' ? value : Date.parse(String(value));
  return Number.isFinite(time) ? time : null;
}

/**
 * A number, or `null` for what is not one.
 *
 * @param value - The value.
 * @returns The number, or `null`.
 */
function numberOf(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** How each column type holds a value. */
const cells: Readonly<Record<FieldType, (value: unknown) => unknown>> = {
  time: timeOf,
  number: numberOf,
  boolean: Boolean,
  string: (value) => (typeof value === 'string' ? value : String(value)),
};

/**
 * A value as its column holds it.
 *
 * @param type - The column type.
 * @param value - The value from SQLite.
 * @returns The frame value.
 */
function cellOf(type: FieldType, value: unknown): unknown {
  return value === null || value === undefined ? null : cells[type](value);
}

/** The result of a statement. */
export interface Result {
  /** The column names. */
  readonly columns: readonly string[];
  /** The declared types, `null` for an expression. */
  readonly declared: readonly (string | null)[];
  /** The rows, at most one more than the row limit. */
  readonly rows: readonly (readonly unknown[])[];
}

/**
 * The frame of a result.
 *
 * @param kit - The kit, for the frame builder.
 * @param result - The result.
 * @param context - The execution context.
 * @param durationMs - How long the query took.
 * @returns The frame.
 */
export function frameOf(
  kit: ConnectorKit,
  result: Result,
  context: ExecutionContext,
  durationMs: number,
): Frame {
  const fields: Field[] = result.columns.map((name, index) => ({
    name,
    type:
      typeOfDeclared(result.declared[index]) ?? typeOfValues(result.rows.map((row) => row[index])),
  }));
  const builder = kit.createFrameBuilder({
    refId: context.refId,
    fields,
    maxRows: context.maxRows,
  });
  for (const row of result.rows)
    if (!builder.add(fields.map((field, index) => cellOf(field.type, row[index])))) break;
  return builder.build(durationMs);
}
