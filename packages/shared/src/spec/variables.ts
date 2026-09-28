/**
 * Dashboard variables. The time range is built in and not listed. A variable changes what a viewer
 * sees, never the saved dashboard, and its value is always bound, never pasted into a query.
 */
import { z } from 'zod';
import { variableNameSchema } from './names.ts';
import { queryTemplateSchema } from './queries.ts';

/** Validates one variable value. */
const valueSchema = z.string().max(200);

/** Validates a variable label. */
const labelSchema = z.string().min(1).max(60).optional();

/** Validates a variable whose options are listed in the spec. */
const customVariableSchema = z.strictObject({
  kind: z.literal('custom'),
  name: variableNameSchema,
  label: labelSchema,
  options: z.array(valueSchema).min(1).max(200),
  default: z.union([valueSchema, z.array(valueSchema).max(200)]),
  multi: z.boolean().optional(),
});

/** Validates a variable whose options come from a query, such as label values. */
const queryVariableSchema = z.strictObject({
  kind: z.literal('query'),
  name: variableNameSchema,
  label: labelSchema,
  source: queryTemplateSchema,
  default: z.union([valueSchema, z.array(valueSchema).max(200)]).optional(),
  multi: z.boolean().optional(),
  includeAll: z.boolean().optional(),
});

/** Validates a free-text variable, optionally held to a pattern. */
const textVariableSchema = z.strictObject({
  kind: z.literal('text'),
  name: variableNameSchema,
  label: labelSchema,
  default: valueSchema,
  pattern: z.string().min(1).max(200).optional(),
});

/** Validates a variable. */
export const variableSchema = z.discriminatedUnion('kind', [
  customVariableSchema,
  queryVariableSchema,
  textVariableSchema,
]);

/** A dashboard variable. */
export type Variable = z.infer<typeof variableSchema>;

/** Validates the values a viewer picked, by variable name. */
export const variableValuesSchema = z.record(
  variableNameSchema,
  z.union([valueSchema, z.array(valueSchema).max(200)]),
);

/** The values a viewer picked, by variable name. */
export type VariableValues = z.infer<typeof variableValuesSchema>;

/** The value of "All" in a query-backed variable with `includeAll`. */
export const allValue = '$__all';
