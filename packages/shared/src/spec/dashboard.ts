/**
 * The dashboard spec: the contract between the model, the server and the renderer. Plain JSON,
 * with data referenced by refId, queries as templates and formatting by name.
 */
import { z } from 'zod';
import { slugSchema } from './names.ts';
import { panelQuerySchema } from './queries.ts';
import { timeRangeSchema } from './time.ts';
import { variableSchema } from './variables.ts';
import { viewSchema } from './views.ts';

/** The columns of the dashboard grid. */
export const gridColumns = 12;

/** Validates where a panel sits: a 12-column grid, heights in rows of 40 pixels. */
const gridSchema = z
  .strictObject({
    x: z
      .int()
      .min(0)
      .max(gridColumns - 1),
    y: z.int().min(0).max(1000),
    w: z.int().min(1).max(gridColumns),
    h: z.int().min(1).max(40),
  })
  .refine((grid) => grid.x + grid.w <= gridColumns, 'The panel is wider than the grid.');

/** Validates a panel. */
const panelSchema = z.strictObject({
  id: slugSchema,
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  grid: gridSchema,
  queries: z.array(panelQuerySchema).min(1).max(4),
  view: viewSchema,
});

/** A panel. */
export type Panel = z.infer<typeof panelSchema>;

/** Validates an annotation: dashboard-wide markers, such as deploys, from a query. */
const annotationSchema = z.strictObject({
  id: slugSchema,
  label: z.string().min(1).max(60),
  query: panelQuerySchema,
  timeField: z.string().min(1).max(200),
  textField: z.string().min(1).max(200),
});

/** An annotation. */
export type Annotation = z.infer<typeof annotationSchema>;

/** Validates a dashboard spec, version 1. */
export const dashboardSpecSchema = z.strictObject({
  specVersion: z.literal(1),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  timezone: z.string().min(1).max(64).optional(),
  time: timeRangeSchema,
  variables: z.array(variableSchema).max(20).default([]),
  panels: z.array(panelSchema).max(60),
  annotations: z.array(annotationSchema).max(10).default([]),
});

/** A dashboard spec, as parsed: `variables` and `annotations` are always present. */
export type DashboardSpec = z.output<typeof dashboardSpecSchema>;
