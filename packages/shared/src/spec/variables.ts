/**
 * Dashboard variables. The time range is built in and not listed. A variable changes what a viewer
 * sees, never the saved dashboard, and its value is always bound, never pasted into a query.
 */
import { z } from 'zod';
import { variableNameSchema } from './names.ts';
import { queryTemplateSchema } from './queries.ts';
import { variableOptionSchema, variableValueSchema } from './variable-options.ts';

/** Validates one variable value. */
const valueSchema = variableValueSchema;

/**
 * The longest value a text variable takes. A viewer types it and the server matches it against the
 * variable's pattern, so it is kept short.
 */
export const maxTextValueLength = 100;

/** Validates a variable label. */
const labelSchema = z.string().min(1).max(60).optional();

/** Validates a variable whose options are listed in the spec. */
const customVariableSchema = z.strictObject({
  kind: z.literal('custom'),
  name: variableNameSchema,
  label: labelSchema,
  /** The values, each alone or with a label a viewer reads. The default names values. */
  options: z.array(variableOptionSchema).min(1).max(200),
  default: z.union([valueSchema, z.array(valueSchema).max(200)]),
  multi: z.boolean().optional(),
  /** Whether the menu offers "All", which binds every option; it may be the default. */
  includeAll: z.boolean().optional(),
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

/**
 * The most values a computed variable holds. A source that returns more is cut, so a list bound
 * into a query stays small.
 */
export const maxComputedValues = 1000;

/** The longest value a computed variable holds; a longer one fails the variable. */
export const maxComputedValueLength = 200;

/**
 * Validates a hidden variable whose value the server computes with a query, on any connector,
 * with the variables declared before it: the column `field` (the first column when left out) of
 * the first row, or of every row when `multi`, distinct, at most {@link maxComputedValues}. No
 * menu shows it and no choice or URL sets it. It is computed again when the range or a variable
 * it uses changes.
 */
const computedVariableSchema = z.strictObject({
  kind: z.literal('computed'),
  name: variableNameSchema,
  source: queryTemplateSchema,
  field: z.string().min(1).max(200).optional(),
  multi: z.boolean().optional(),
});

/** Validates a free-text variable, optionally held to a pattern. */
const textVariableSchema = z.strictObject({
  kind: z.literal('text'),
  name: variableNameSchema,
  label: labelSchema,
  default: valueSchema,
  pattern: z.string().min(1).max(200).optional(),
});

/**
 * The interval option the server picks: a duration that suits the time range and the width of the
 * chart, bound like any other duration.
 */
export const autoInterval = 'auto';

/**
 * Validates an option of an interval variable: a duration, or `auto`. One pattern, not a union,
 * keeps the schema the model receives as small as a bare duration's.
 */
const intervalOptionSchema = z
  .string()
  .regex(/^(?:\d{1,5}[smhd]|auto)$/, 'Use a duration such as 1m or 1h, or auto.');

/**
 * Validates an interval variable: durations to pick from, such as `1m`, `5m` and `1h`, and `auto`.
 * It is the only variable PromQL takes where a duration goes (`[$interval]`, `step`), and SQL
 * binds it like any other value (`:interval::interval`).
 */
const intervalVariableSchema = z.strictObject({
  kind: z.literal('interval'),
  name: variableNameSchema,
  label: labelSchema,
  options: z.array(intervalOptionSchema).min(1).max(20),
  default: intervalOptionSchema,
});

/** Validates a variable a viewer chooses: every kind but a computed one. */
export const chosenVariableSchema = z.discriminatedUnion('kind', [
  customVariableSchema,
  queryVariableSchema,
  textVariableSchema,
  intervalVariableSchema,
]);

/** Validates a variable. */
export const variableSchema = z.discriminatedUnion('kind', [
  ...chosenVariableSchema.options,
  computedVariableSchema,
]);

/** A dashboard variable. */
export type Variable = z.infer<typeof variableSchema>;

/**
 * The query a variable's values come from.
 *
 * @param variable - The variable.
 * @returns The source of a query-backed or a computed variable; none for the others.
 */
export function variableSource(
  variable: Variable,
): z.infer<typeof queryTemplateSchema> | undefined {
  return variable.kind === 'query' || variable.kind === 'computed' ? variable.source : undefined;
}

/**
 * A variable's default value.
 *
 * @param variable - The variable.
 * @returns Its default; none for a computed variable, which takes no choice.
 */
export function variableDefault(variable: Variable): string | readonly string[] | undefined {
  return 'default' in variable ? variable.default : undefined;
}

/** A variable a viewer chooses: every kind but a computed one. */
export type ChosenVariable = Exclude<Variable, { kind: 'computed' }>;

/**
 * Whether a viewer chooses a variable's value.
 *
 * @param variable - The variable.
 * @returns `false` for a computed variable.
 */
export function isChosen(variable: Variable): variable is ChosenVariable {
  return variable.kind !== 'computed';
}

/**
 * Whether a variable takes several values at once.
 *
 * @param variable - The variable.
 * @returns `true` for a custom, query-backed or computed variable marked `multi`.
 */
export function isMultiValue(variable: Variable): boolean {
  return 'multi' in variable && variable.multi === true;
}

/** Validates the values a viewer picked, by variable name. */
export const variableValuesSchema = z.record(
  variableNameSchema,
  z.union([valueSchema, z.array(valueSchema).max(200)]),
);

/** The values a viewer picked, by variable name. */
export type VariableValues = z.infer<typeof variableValuesSchema>;

/** The value of "All" in a variable with `includeAll`. */
export const allValue = '$__all';

/**
 * Whether a variable's menu offers "All".
 *
 * @param variable - The variable.
 * @returns `true` for a custom or query-backed variable with `includeAll`.
 */
export function offersAll(variable: Variable): boolean {
  return 'includeAll' in variable && variable.includeAll === true;
}
