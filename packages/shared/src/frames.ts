/** Result frames: the column-based format every connector returns and the browser renders. */
import { z } from 'zod';

/** The value types a field can hold. Times are Unix epoch milliseconds. */
export const fieldTypes = ['time', 'number', 'string', 'boolean'] as const;

/** A field value type. */
export type FieldType = (typeof fieldTypes)[number];

/** Validates a field: one column of a frame. */
export const fieldSchema = z.object({
  name: z.string().min(1),
  type: z.enum(fieldTypes),
  labels: z.record(z.string(), z.string()).optional(),
  unit: z.string().optional(),
});

/** One column of a frame: its name, value type, and for time series, the series labels. */
export type Field = z.infer<typeof fieldSchema>;

/** Validates what a frame says about itself. */
const frameMetaSchema = z.object({
  rowCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  durationMs: z.number().nonnegative(),
});

/** Validates the shape of a frame. {@link frameProblems} also checks the values. */
export const frameSchema = z.object({
  refId: z.string().min(1),
  name: z.string().optional(),
  fields: z.array(fieldSchema),
  values: z.array(z.array(z.unknown())),
  meta: frameMetaSchema,
});

/**
 * A query result in columns: `values[i]` holds the values of `fields[i]`, one per row. A missing
 * value is `null`.
 */
export type Frame = z.infer<typeof frameSchema>;

/**
 * Whether a value fits a field type.
 *
 * @param type - The field type.
 * @param value - A value of that field.
 * @returns `true` for `null` and for values of the type; times must be finite numbers.
 */
function fitsType(type: FieldType, value: unknown): boolean {
  if (value === null) return true;
  if (type === 'time' || type === 'number') {
    return typeof value === 'number' && Number.isFinite(value);
  }
  return typeof value === type;
}

/**
 * Lists everything wrong with a frame: its shape, column lengths, and value types.
 *
 * @param frame - The frame to check, as received.
 * @returns One sentence per problem, empty when the frame is valid.
 */
export function frameProblems(frame: unknown): string[] {
  const parsed = frameSchema.safeParse(frame);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  }
  const { fields, values, meta } = parsed.data;
  if (values.length !== fields.length) {
    return [`${fields.length} fields but ${values.length} value columns`];
  }
  return fields.flatMap((field, index) => {
    const column = values[index] ?? [];
    if (column.length !== meta.rowCount) {
      return [`field "${field.name}" has ${column.length} values for ${meta.rowCount} rows`];
    }
    const wrong = column.findIndex((value) => !fitsType(field.type, value));
    return wrong === -1 ? [] : [`field "${field.name}" row ${wrong} is not a ${field.type}`];
  });
}

/**
 * Orders two values of a frame: numbers by value, anything else as text.
 *
 * @param first - One value.
 * @param second - The other.
 * @returns Negative, zero or positive.
 */
export function compareFrameValues(first: unknown, second: unknown): number {
  if (typeof first === 'number' && typeof second === 'number') return first - second;
  return String(first ?? '').localeCompare(String(second ?? ''));
}
