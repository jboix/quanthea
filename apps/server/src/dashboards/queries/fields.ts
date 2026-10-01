/**
 * The fields data requests share: names, durations, connectors and filters. Pattern checks run in
 * code rather than as JSON schema patterns, so the edit tool's input schema stays small.
 */
import { z } from 'zod';

/**
 * A string that must match a pattern, checked in code so the JSON schema stays short.
 *
 * @param pattern - The pattern.
 * @param message - What to write instead.
 * @returns The schema.
 */
export function matching(pattern: RegExp, message: string) {
  return z
    .string()
    .max(200)
    .refine((value) => pattern.test(value), message);
}

/** A label or column name. */
export const nameSchema = matching(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Use a plain label or column name.');

/** A table, or a schema and a table. */
export const tableSchema = matching(
  /^[A-Za-z_]\w*(\.[A-Za-z_]\w*)?$/,
  'Use a table name, or schema.table.',
);

/** A duration such as `5m`, or an interval variable such as `$interval`. */
export const durationSchema = matching(
  /^(\d{1,5}[smhd]|\$[A-Za-z_]\w*)$/,
  'Use a duration such as 5m, or an interval variable such as $interval.',
);

/** A connector name. */
export const connectorSchema = z.string().min(1).max(100);

/** One filter: a field compared with a value, a regular expression, or a `$variable`. */
export const filterSchema = z.strictObject({
  field: nameSchema,
  op: z.enum(['=', '!=', '=~', '!~']).default('='),
  value: z.string().max(200),
});

/** A filter. */
export type Filter = z.output<typeof filterSchema>;

/** Filters, all of which must hold. */
export const filtersSchema = z.array(filterSchema).max(10).default([]);

/** A document field path, such as `@timestamp` or `session.player.platform`. */
export const fieldPathSchema = matching(
  /^@?[A-Za-z_][A-Za-z0-9_.@-]*$/,
  'Use a field name or a dotted path, such as session.player.platform.',
);

/** One filter on a document field: equal, not equal, matching or not a regular expression. */
export const pathFilterSchema = z.strictObject({
  field: fieldPathSchema,
  op: z.enum(['=', '!=', '=~', '!~']).default('='),
  value: z.string().max(200),
});

/** A filter on a document field. */
export type PathFilter = z.output<typeof pathFilterSchema>;

/** Filters on document fields, all of which must hold. */
export const pathFiltersSchema = z.array(pathFilterSchema).max(10).default([]);
