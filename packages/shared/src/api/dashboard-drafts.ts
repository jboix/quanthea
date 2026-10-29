/**
 * The endpoints of hand edits in a dashboard thread: the owner of the thread or an admin changes
 * one draft panel from the inspector. A test run checks the panel and runs its queries without
 * saving; a save does the same and adds a version and a card the agent reads next turn.
 */
import { z } from 'zod';
import { chartUnits } from '../chart-recipes/conventions.ts';
import { timeAxisModes } from '../spec/views.ts';
import { panelDiffSchema } from '../threads.ts';
import { defineEndpoint } from './contract.ts';

/** Validates the path of a hand edit: the thread and the panel. */
const panelParams = z.object({ threadId: z.string().min(1), panelId: z.string().min(1).max(64) });

/** Validates a chart picked from the recipes: the view is rebuilt from it on the test run's data. */
export const handChartSchema = z.object({
  /** The recipe's id, such as `trend.line`. */
  recipe: z.string().min(1).max(60),
  /** The recipe's variants to apply, in order. */
  variants: z.array(z.string().min(1).max(40)).max(6),
  /** How the values read; `number` when left out. */
  unit: z.enum(chartUnits).optional(),
  /** What a time axis covers; the whole time range when left out. */
  timeAxis: z.enum(timeAxisModes).optional(),
});

/** A chart picked from the recipes. */
export type HandChart = z.infer<typeof handChartSchema>;

/** Validates a hand edit of one panel. */
const panelEditSchema = z.object({
  /** The latest version the edit starts from; a conflict once another version is saved. */
  basedOn: z.int().min(1),
  /** The whole panel as the person left it; checked like any write. Its id stays the panel's. */
  panel: z.unknown(),
  /** A chart from the recipes, which replaces the panel's view. */
  chart: handChartSchema.optional(),
});

/** A hand edit of one panel. */
export type PanelEdit = z.infer<typeof panelEditSchema>;

/** Validates a problem found in a hand-edited panel, at a path inside the panel. */
const panelIssueSchema = z.object({ path: z.string(), message: z.string() });

/** Validates what one query of the panel returned on its test run. */
const queryTestSchema = z.object({
  refId: z.string(),
  /** How many rows it returned; zero when it failed. */
  rows: z.int().min(0),
  /** Why it failed, if it did. */
  error: z.string().optional(),
});

/** Validates the outcome of a test run of a hand-edited panel. */
const panelTestSchema = z.object({
  /** Whether the panel can be saved: no issue, and every query runs. */
  ok: z.boolean(),
  /** What is wrong with the panel, at paths inside it such as `queries[0].sql`. */
  issues: z.array(panelIssueSchema).max(50),
  /** Each query's test run. */
  queries: z.array(queryTestSchema).max(4),
  /** The panel as it would be saved, its view rebuilt when a chart was picked. */
  panel: z.unknown().optional(),
});

/** The outcome of a test run of a hand-edited panel. */
export type PanelTestOutcome = z.infer<typeof panelTestSchema>;

/** Checks and test-runs a hand-edited panel without saving it. */
export const testPanelEditEndpoint = defineEndpoint({
  method: 'POST',
  path: '/threads/:threadId/dashboard-draft/panels/:panelId/test',
  params: panelParams,
  body: panelEditSchema,
  output: panelTestSchema,
});

/** Saves a hand-edited panel as a new draft version; refused with the issues when it fails. */
export const handEditPanelEndpoint = defineEndpoint({
  method: 'POST',
  path: '/threads/:threadId/dashboard-draft/panels/:panelId',
  params: panelParams,
  body: panelEditSchema,
  output: z.object({
    dashboardId: z.string(),
    version: z.int(),
    panels: z.array(panelDiffSchema),
  }),
});
