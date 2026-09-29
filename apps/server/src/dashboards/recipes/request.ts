/**
 * What the agent asks for, instead of writing a spec: panels by recipe, variables, the time range
 * and deploy markers. This is the edit tool's input schema, so providers that constrain tool input
 * keep the model to it. It stays small: name checks run in code rather than as JSON schema
 * patterns, and the conventions are explained once in the build prompt.
 */
import { panelUnits, type SavedRecipe, timeRangeSchema, variableSchema } from '@querent/shared';
import { z } from 'zod';

/**
 * A string that must match a pattern, checked in code so the JSON schema stays short.
 *
 * @param pattern - The pattern.
 * @param message - What to write instead.
 * @returns The schema.
 */
function matching(pattern: RegExp, message: string) {
  return z
    .string()
    .max(200)
    .refine((value) => pattern.test(value), message);
}

/** A label or column name. */
const nameSchema = matching(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Use a plain label or column name.');

/** A table, or a schema and a table. */
const tableSchema = matching(
  /^[A-Za-z_]\w*(\.[A-Za-z_]\w*)?$/,
  'Use a table name, or schema.table.',
);

/** A duration such as `5m`, or an interval variable such as `$interval`. */
const durationSchema = matching(
  /^(\d{1,5}[smhd]|\$[A-Za-z_]\w*)$/,
  'Use a duration such as 5m, or an interval variable such as $interval.',
);

/** A connector name. */
const connectorSchema = z.string().min(1).max(100);

/** One filter: a field compared with a value, a regular expression, or a `$variable`. */
const filterSchema = z.strictObject({
  field: nameSchema,
  op: z.enum(['=', '!=', '=~', '!~']).default('='),
  value: z.string().max(200),
});

/** A filter. */
export type Filter = z.output<typeof filterSchema>;

/** Filters, all of which must hold. */
const filtersSchema = z.array(filterSchema).max(10).default([]);

/** How values read; percent expects a ratio from 0 to 1. */
const unitSchema = z.enum(panelUnits);

/** A unit. */
export type Unit = z.output<typeof unitSchema>;

/** How wide a panel is. */
const widthSchema = z.enum(['quarter', 'third', 'half', 'full']);

/** A panel width. */
export type Width = z.output<typeof widthSchema>;

/** What every recipe has; `replaces` names a panel to rebuild in place. */
const panelBase = {
  title: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  width: widthSchema.optional(),
  replaces: z.string().max(63).optional(),
};

/** What every PromQL recipe has. */
const promqlBase = {
  ...panelBase,
  connector: connectorSchema,
  metric: z.string().max(200),
  filters: filtersSchema,
  by: z.array(nameSchema).max(4).default([]),
};

/** A counter's per-second rate. */
const rateSchema = z.strictObject({
  recipe: z.literal('rate'),
  ...promqlBase,
  window: durationSchema.default('$__rate_interval'),
  show: z.enum(['line', 'bar', 'stat']).default('line'),
  unit: unitSchema.default('per-second'),
});

/** The share of a counter that also matches `match`, such as 5xx over all requests. */
const ratioSchema = z.strictObject({
  recipe: z.literal('ratio'),
  ...promqlBase,
  match: z.array(filterSchema).min(1).max(5),
  window: durationSchema.default('$__rate_interval'),
  show: z.enum(['line', 'stat']).default('line'),
});

/** Percentiles of a histogram. */
const latencySchema = z.strictObject({
  recipe: z.literal('latency'),
  ...promqlBase,
  quantiles: z.array(z.number().gt(0).lt(1)).min(1).max(4).default([0.5, 0.95, 0.99]),
  window: durationSchema.default('$__rate_interval'),
  show: z.enum(['line', 'stat']).default('line'),
  unit: z.enum(['seconds', 'milliseconds']).default('seconds'),
});

/** A gauge, aggregated. */
const gaugeSchema = z.strictObject({
  recipe: z.literal('gauge'),
  ...promqlBase,
  aggregate: z.enum(['sum', 'avg', 'max', 'min']).default('sum'),
  show: z.enum(['line', 'stat']).default('line'),
  unit: unitSchema.default('number'),
});

/** The top values of a counter over the time range, by label. */
const topSchema = z.strictObject({
  recipe: z.literal('top'),
  ...promqlBase,
  by: z.array(nameSchema).min(1).max(4),
  limit: z.int().min(1).max(50).default(10),
  show: z.enum(['table', 'bar']).default('table'),
});

/** What a SQL recipe measures; count needs no column. */
const measureSchema = z
  .strictObject({
    fn: z.enum(['count', 'sum', 'avg', 'min', 'max', 'count_distinct']),
    column: nameSchema.optional(),
  })
  .default({ fn: 'count' });

/** What every SQL recipe has. */
const sqlBase = {
  ...panelBase,
  connector: connectorSchema,
  table: tableSchema,
  filters: filtersSchema,
};

/** A measure over time, in buckets, split by a column when `by` is given. */
const sqlSeriesSchema = z.strictObject({
  recipe: z.literal('sql-series'),
  ...sqlBase,
  time: nameSchema,
  measure: measureSchema,
  by: nameSchema.optional(),
  bucket: durationSchema.default('5m'),
  show: z.enum(['line', 'bar']).default('line'),
  unit: unitSchema.default('number'),
});

/** A measure by the values of a column, kept to the range when `time` is given. */
const sqlBreakdownSchema = z.strictObject({
  recipe: z.literal('sql-breakdown'),
  ...sqlBase,
  by: nameSchema,
  time: nameSchema.optional(),
  measure: measureSchema,
  limit: z.int().min(1).max(100).default(10),
  show: z.enum(['table', 'bar', 'pie']).default('bar'),
  unit: unitSchema.default('number'),
});

/** One number, kept to the range when `time` is given. */
const sqlStatSchema = z.strictObject({
  recipe: z.literal('sql-stat'),
  ...sqlBase,
  time: nameSchema.optional(),
  measure: measureSchema,
  unit: unitSchema.default('number'),
});

/** The latest rows, newest first when `time` is given. */
const sqlRowsSchema = z.strictObject({
  recipe: z.literal('sql-rows'),
  ...sqlBase,
  columns: z.array(nameSchema).min(1).max(12),
  time: nameSchema.optional(),
  limit: z.int().min(1).max(200).default(20),
});

/** A raw query of a custom panel. */
const rawQuerySchema = z.strictObject({
  connector: connectorSchema,
  language: z.enum(['sql', 'promql']),
  query: z.string().min(1).max(10_000),
  instant: z.boolean().optional(),
});

/** Anything the recipes cannot say: raw queries and a view kind. */
const customSchema = z.strictObject({
  recipe: z.literal('custom'),
  ...panelBase,
  queries: z.array(rawQuerySchema).min(1).max(4),
  show: z.enum(['line', 'bar', 'category-bar', 'pie', 'stat', 'table']),
  unit: unitSchema.default('number'),
  columns: z.array(z.string().min(1).max(200)).max(20).optional(),
  reduce: z.enum(['last', 'first', 'max', 'min', 'mean', 'sum']).default('last'),
  // Not z.json(): its recursive schema is refused by Gemini. The spec check validates the values.
  option: z.record(z.string(), z.unknown()).optional(),
});

/** A saved recipe, by id, with its placeholders filled. */
const savedSchema = z.strictObject({
  recipe: z.literal('saved'),
  ...panelBase,
  name: z.string().max(40),
  connector: connectorSchema,
  params: z.record(z.string(), z.string().max(200)).default({}),
});

/** The built-in recipes' schemas, by id. */
const builtInSchemas = {
  rate: rateSchema,
  ratio: ratioSchema,
  latency: latencySchema,
  gauge: gaugeSchema,
  top: topSchema,
  'sql-series': sqlSeriesSchema,
  'sql-breakdown': sqlBreakdownSchema,
  'sql-stat': sqlStatSchema,
  'sql-rows': sqlRowsSchema,
} as const;

/** Validates a panel request, of any recipe. */
export const panelRequestSchema = z.discriminatedUnion('recipe', [
  rateSchema,
  ratioSchema,
  latencySchema,
  gaugeSchema,
  topSchema,
  sqlSeriesSchema,
  sqlBreakdownSchema,
  sqlStatSchema,
  sqlRowsSchema,
  customSchema,
  savedSchema,
]);

/** A panel request. */
export type PanelRequest = z.output<typeof panelRequestSchema>;

/** A panel request of one recipe. */
export type RecipeOf<Name extends PanelRequest['recipe']> = Extract<PanelRequest, { recipe: Name }>;

/** Deploy markers: events from a table, drawn on every time chart. */
const markersSchema = z.strictObject({
  label: z.string().min(1).max(60),
  connector: connectorSchema,
  table: tableSchema,
  time: nameSchema,
  text: nameSchema,
  filters: filtersSchema,
});

/** Markers. */
export type MarkersRequest = z.output<typeof markersSchema>;

/** The recipes a run may use. */
export interface AvailableRecipes {
  /** The built-in recipes' ids. */
  readonly builtIn: readonly string[];
  /** The saved recipes. */
  readonly saved: readonly SavedRecipe[];
}

/**
 * The edit's fields around its panels.
 *
 * @param panels - The schema of one panel request.
 * @returns The edit's schema.
 */
function editSchemaWith<Panel extends z.ZodType>(panels: Panel) {
  return z.strictObject({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(1000).optional(),
    time: timeRangeSchema.optional(),
    variables: z.array(variableSchema).max(20).optional(),
    panels: z.array(panels).max(20).default([]),
    remove: z.array(z.string()).max(20).default([]),
    markers: markersSchema.nullable().optional(),
    summary: z.string().min(1).max(200),
  });
}

/**
 * The edit schema of a run: only the recipes it may use, so providers that constrain tool input
 * keep the model to them. Custom panels are always there; saved recipes when there are some.
 *
 * @param available - The recipes the run may use.
 * @returns The schema. Its output is an {@link EditRequest}.
 */
export function editRequestSchemaFor(available: AvailableRecipes) {
  const builtIn = Object.entries(builtInSchemas)
    .filter(([id]) => available.builtIn.includes(id))
    .map(([, schema]) => schema);
  const saved = available.saved.length > 0 ? [savedSchema] : [];
  return editSchemaWith(z.discriminatedUnion('recipe', [customSchema, ...builtIn, ...saved]));
}

/** Validates an edit: what to set, add, rebuild and remove, in one new version. */
export const editRequestSchema = editSchemaWith(panelRequestSchema);

/** An edit. */
export type EditRequest = z.output<typeof editRequestSchema>;
