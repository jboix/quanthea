/**
 * A chart recipe: presentation only. It names the shape of data it draws and the role of each
 * column, carries an ECharts option template and its variants, and draws on its own from a small
 * fake sample. It never names a connector or a query language.
 */
import { z } from 'zod';
import { type Dataset, datasetSchema, dimensionTypes, shapeKinds } from '../dataset/contract.ts';
import { prepareKinds } from './prepare.ts';

/** The families of chart, by what a chart is for. */
export const chartFamilies = [
  'trend',
  'comparison',
  'distribution',
  'composition',
  'relationship',
  'flow',
  'geo',
  'kpi',
  'table',
  'layout',
] as const;

/** A family of chart. */
export type ChartFamily = (typeof chartFamilies)[number];

/** Validates the column a role takes. */
export const roleSpecSchema = z.strictObject({
  types: z.array(z.enum(dimensionTypes)).min(1),
  required: z.boolean(),
  /** Whether it takes several columns, such as several y values. */
  multiple: z.boolean().optional(),
  description: z.string().min(1).max(200),
});

/** The column a role takes. */
export type RoleSpec = z.infer<typeof roleSpecSchema>;

/** A role's name, such as `x`, `series` or `value`. */
const roleNameSchema = z.string().regex(/^[a-z][a-zA-Z]{0,19}$/);

/** A JSON object: an option or a patch. */
const jsonObjectSchema = z.record(z.string(), z.json());

/** Validates a variant: a named patch of the option. */
const variantSchema = z.strictObject({
  title: z.string().min(1).max(60),
  whenToUse: z.string().min(1).max(200),
  patch: jsonObjectSchema,
  /** Another way to prepare the data, such as `shares` for a 100% stack. */
  prepare: z.enum(prepareKinds).optional(),
});

/** Validates the columns a sample gives each role. */
const sampleRolesSchema = z.record(roleNameSchema, z.union([z.string(), z.array(z.string())]));

/** Validates a recipe. */
export const chartRecipeSchema = z.strictObject({
  id: z.string().regex(/^[a-z]+\.[a-z0-9-]+$/, 'Use family.name, such as trend.line.'),
  title: z.string().min(1).max(60),
  family: z.enum(chartFamilies),
  whenToUse: z.array(z.string().min(1).max(160)).min(1).max(3),
  whenNotToUse: z.array(z.string().min(1).max(160)).max(3),
  data: z.strictObject({
    shape: z.enum(shapeKinds),
    accepts: z.array(z.enum(shapeKinds)).optional(),
    roles: z.record(roleNameSchema, roleSpecSchema),
    limits: z
      .strictObject({
        maxCategories: z.int().min(1).optional(),
        maxSeries: z.int().min(1).optional(),
      })
      .optional(),
  }),
  /** How the panel draws: an ECharts chart, or quanthea's own stat and table views. */
  render: z.enum(['echarts', 'stat', 'table']),
  prepare: z.enum(prepareKinds),
  option: jsonObjectSchema,
  variants: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), variantSchema),
  pitfalls: z.array(z.string().min(1).max(200)).max(5),
  sample: z.strictObject({
    roles: sampleRolesSchema,
    datasets: z.array(datasetSchema).min(1).max(2),
  }),
  queryHints: z.array(z.string().min(1).max(200)).max(3).optional(),
  requires: z.strictObject({ map: z.literal('world') }).optional(),
});

/** A chart recipe. Its samples are read-only datasets, as the sample module builds them. */
export type ChartRecipe = Omit<z.infer<typeof chartRecipeSchema>, 'sample'> & {
  readonly sample: {
    readonly roles: z.infer<typeof sampleRolesSchema>;
    readonly datasets: readonly Dataset[];
  };
};
