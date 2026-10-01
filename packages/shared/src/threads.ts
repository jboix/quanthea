/**
 * Threads: the conversation that authors a dashboard, its plans, and the custom parts its messages
 * carry (plan cards, new dashboard versions, diffs).
 */

import { queryLanguageSchema } from '@quanthea/plugin-kit/contract';
import { z } from 'zod';
import { connectorNameSchema } from './connectors.ts';

/** Where a thread is: asking, waiting for plan approval, building, or ready for small edits. */
export const threadStates = ['idle', 'plan_pending', 'building', 'ready'] as const;

/** A thread state. */
export type ThreadState = (typeof threadStates)[number];

/** What became of a plan. */
export const planStatuses = ['pending', 'approved', 'rejected', 'superseded'] as const;

/** The kinds of panel a plan lists, as the plan card names them. */
export const planPanelKinds = [
  'stat',
  'line',
  'bar',
  'table',
  'pie',
  'scatter',
  'heatmap',
  'gauge',
] as const;

/** Validates a plan: what the agent proposes to build, for a person to approve. */
export const planSchema = z.object({
  title: z.string().min(1).max(200),
  /** The variables and time range, in words, such as `time = 26 Sep 13:30–15:00`. */
  variables: z.array(z.string().max(200)).max(20),
  panels: z
    .array(
      z.object({
        kind: z.enum(planPanelKinds),
        title: z.string().min(1).max(200),
        language: queryLanguageSchema,
        connector: connectorNameSchema,
      }),
    )
    .min(1)
    .max(30),
});

/** A plan. */
export type Plan = z.infer<typeof planSchema>;

/** Validates a plan as the API returns it. */
export const planViewSchema = z.object({
  id: z.string(),
  status: z.enum(planStatuses),
  body: planSchema,
  decidedBy: z.string().nullable(),
  createdAt: z.number(),
  decidedAt: z.number().nullable(),
});

/** A plan with its status. */
export type PlanView = z.infer<typeof planViewSchema>;

/** Validates the changes of one panel, as the diff card shows them. */
const panelDiffSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['added', 'removed', 'changed', 'same']),
  changes: z.array(
    z.object({ path: z.string(), before: z.string().optional(), after: z.string().optional() }),
  ),
});

/** The custom parts of thread messages, by name: `data-plan`, `data-version`, `data-diff`. */
/** Validates a pinned dashboard that may already answer a question. */
const pinnedMatchSchema = z.object({
  dashboardId: z.string(),
  title: z.string(),
  version: z.int(),
  panels: z.array(z.string()).max(12),
});

export const threadDataSchemas = {
  /** Pinned dashboards that may already answer the first question, found with no model. */
  matches: z.object({ dashboards: z.array(pinnedMatchSchema).max(5) }),
  /** A proposed plan, for the plan card. */
  plan: z.object({ planId: z.string(), body: planSchema }),
  /** A new dashboard version; the right pane moves to it. */
  version: z.object({ dashboardId: z.string(), version: z.int(), summary: z.string() }),
  /** What changed from one version to the next, for the diff card. */
  diff: z.object({
    dashboardId: z.string(),
    from: z.int(),
    to: z.int(),
    panels: z.array(panelDiffSchema),
  }),
};

/** The data of each custom part. */
export type ThreadData = {
  [Name in keyof typeof threadDataSchemas]: z.infer<(typeof threadDataSchemas)[Name]>;
};
