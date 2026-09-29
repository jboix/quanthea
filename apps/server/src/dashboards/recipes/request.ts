/**
 * What the agent asks for, instead of writing a spec: panels by recipe, variables, the time range
 * and deploy markers. The schemas carry descriptions, so the tool's JSON schema teaches the model
 * the recipes, and providers that constrain tool input keep it to this shape.
 */
import { panelQuerySchema, timeRangeSchema, variableSchema, viewSchema } from '@querent/shared';
import { z } from 'zod';

/** A label or column name. */
const nameSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Use a plain label or column name.')
  .describe('A label or column name from the catalog.');

/** A connector name. */
const connectorSchema = z.string().min(1).max(100).describe('The connector, from the catalog.');

/** One filter: a field compared with a value or a variable. */
const filterSchema = z.strictObject({
  field: nameSchema,
  op: z.enum(['=', '!=', '=~', '!~']).default('='),
  value: z
    .string()
    .max(200)
    .describe('A value, a regular expression for =~ and !~, or a variable such as $service.'),
});

/** A filter. */
export type Filter = z.output<typeof filterSchema>;

/** Filters, all of which must hold. */
const filtersSchema = z.array(filterSchema).max(10).default([]);

/** A PromQL range: a duration, or an interval variable. */
const windowSchema = z
  .string()
  .regex(/^(\d{1,5}[smhd]|\$[A-Za-z_]\w*)$/, 'Use a duration such as 5m, or $interval.')
  .describe('The rate window: a duration such as 5m, or an interval variable such as $interval.');

/** How values read. */
const unitSchema = z
  .enum(['number', 'percent', 'bytes', 'seconds', 'milliseconds', 'per-second', 'EUR', 'USD'])
  .describe('How values read. percent expects a ratio from 0 to 1.');

/** A unit. */
export type Unit = z.output<typeof unitSchema>;

/** How wide a panel is. */
const widthSchema = z.enum(['quarter', 'third', 'half', 'full']);

/** A panel width. */
export type Width = z.output<typeof widthSchema>;

/** What every recipe has. */
const panelBase = {
  title: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  width: widthSchema.optional().describe('Stats default to a quarter, charts to full width.'),
};

/** What every PromQL recipe has. */
const promqlBase = {
  ...panelBase,
  connector: connectorSchema,
  filters: filtersSchema,
  by: z.array(nameSchema).max(4).default([]).describe('Labels to split by, one series each.'),
};

/** The per-second rate of a counter. */
const rateSchema = z.strictObject({
  recipe: z.literal('rate'),
  ...promqlBase,
  metric: z.string().describe('A counter, such as http_requests_total.'),
  window: windowSchema.default('$__rate_interval'),
  show: z.enum(['line', 'bar', 'stat']).default('line'),
  unit: unitSchema.default('per-second'),
});

/** The share of a counter that matches extra filters, such as 5xx over all requests. */
const ratioSchema = z.strictObject({
  recipe: z.literal('ratio'),
  ...promqlBase,
  metric: z.string().describe('A counter, such as http_requests_total.'),
  match: z.array(filterSchema).min(1).max(5).describe('What counts, such as code =~ "5..".'),
  window: windowSchema.default('$__rate_interval'),
  show: z.enum(['line', 'stat']).default('line'),
});

/** Percentiles of a histogram. */
const latencySchema = z.strictObject({
  recipe: z.literal('latency'),
  ...promqlBase,
  metric: z.string().describe('The histogram, with or without _bucket.'),
  quantiles: z.array(z.number().gt(0).lt(1)).min(1).max(4).default([0.5, 0.95, 0.99]),
  window: windowSchema.default('$__rate_interval'),
  show: z.enum(['line', 'stat']).default('line'),
  unit: z.enum(['seconds', 'milliseconds']).default('seconds').describe('The unit of the metric.'),
});

/** The current value of a gauge. */
const gaugeSchema = z.strictObject({
  recipe: z.literal('gauge'),
  ...promqlBase,
  metric: z.string(),
  aggregate: z.enum(['sum', 'avg', 'max', 'min']).default('sum'),
  show: z.enum(['line', 'stat']).default('line'),
  unit: unitSchema.default('number'),
});

/** The top values of a counter over the time range, by label. */
const topSchema = z.strictObject({
  recipe: z.literal('top'),
  ...promqlBase,
  metric: z.string(),
  by: z.array(nameSchema).min(1).max(4),
  limit: z.int().min(1).max(50).default(10),
  show: z.enum(['table', 'bar']).default('table'),
});

/** What a SQL recipe measures. */
const measureSchema = z
  .strictObject({
    fn: z.enum(['count', 'sum', 'avg', 'min', 'max', 'count_distinct']),
    column: nameSchema.optional().describe('Required except for count.'),
  })
  .default({ fn: 'count' });

/** What every SQL recipe has. */
const sqlBase = {
  ...panelBase,
  connector: connectorSchema,
  table: z
    .string()
    .regex(/^[A-Za-z_]\w*(\.[A-Za-z_]\w*)?$/, 'Use a table name, or schema.table.')
    .describe('A table from the catalog.'),
  filters: filtersSchema,
};

/** A measure over time, bucketed. */
const sqlSeriesSchema = z.strictObject({
  recipe: z.literal('sql-series'),
  ...sqlBase,
  time: nameSchema.describe('The timestamp column.'),
  measure: measureSchema,
  by: nameSchema.optional().describe('A column to split by, one series per value.'),
  bucket: windowSchema.default('5m').describe('The bucket: a duration, or $interval.'),
  show: z.enum(['line', 'bar']).default('line'),
  unit: unitSchema.default('number'),
});

/** A measure by the values of a column. */
const sqlBreakdownSchema = z.strictObject({
  recipe: z.literal('sql-breakdown'),
  ...sqlBase,
  by: nameSchema,
  time: nameSchema.optional().describe('A timestamp column, to keep to the time range.'),
  measure: measureSchema,
  limit: z.int().min(1).max(100).default(10),
  show: z.enum(['table', 'bar', 'pie']).default('bar'),
  unit: unitSchema.default('number'),
});

/** One number. */
const sqlStatSchema = z.strictObject({
  recipe: z.literal('sql-stat'),
  ...sqlBase,
  time: nameSchema.optional().describe('A timestamp column, to keep to the time range.'),
  measure: measureSchema,
  unit: unitSchema.default('number'),
});

/** The latest rows. */
const sqlRowsSchema = z.strictObject({
  recipe: z.literal('sql-rows'),
  ...sqlBase,
  columns: z.array(nameSchema).min(1).max(12),
  time: nameSchema.optional().describe('A timestamp column: newest first, within the range.'),
  limit: z.int().min(1).max(200).default(20),
});

/** Anything the recipes cannot say: queries and a view, as in the spec. */
const customSchema = z.strictObject({
  recipe: z.literal('custom'),
  ...panelBase,
  queries: z.array(panelQuerySchema).min(1).max(4),
  view: viewSchema,
});

/** Validates a panel request. */
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
]);

/** A panel request. */
export type PanelRequest = z.output<typeof panelRequestSchema>;

/** A panel request of one recipe. */
export type RecipeOf<Name extends PanelRequest['recipe']> = Extract<PanelRequest, { recipe: Name }>;

/** Deploy markers: events from a table, drawn on every time chart. */
const markersSchema = z.strictObject({
  label: z.string().min(1).max(60).describe('Such as deploy.'),
  connector: connectorSchema,
  table: sqlBase.table,
  time: nameSchema.describe('The timestamp column.'),
  text: nameSchema.describe('The column shown next to the line.'),
  filters: filtersSchema,
});

/** Markers. */
export type MarkersRequest = z.output<typeof markersSchema>;

/** Validates an edit: what to set, add, replace and remove, in one new version. */
export const editRequestSchema = z.strictObject({
  title: z.string().min(1).max(200).optional().describe('The dashboard title; required at first.'),
  description: z.string().max(1000).optional(),
  time: timeRangeSchema.optional().describe('The default range, such as now-6h to now.'),
  variables: z
    .array(variableSchema)
    .max(20)
    .optional()
    .describe('Replaces all variables when given.'),
  add: z.array(panelRequestSchema).max(20).default([]).describe('New panels, in reading order.'),
  replace: z
    .array(z.strictObject({ panelId: z.string(), panel: panelRequestSchema }))
    .max(20)
    .default([])
    .describe('Panels to rebuild in place: same id, same position.'),
  remove: z.array(z.string()).max(20).default([]).describe('Ids of panels to remove.'),
  markers: markersSchema
    .nullable()
    .optional()
    .describe('Deploy markers on the time charts; null removes them.'),
  summary: z.string().min(1).max(200).describe('What changed, in a few words.'),
});

/** An edit. */
export type EditRequest = z.output<typeof editRequestSchema>;
