/**
 * Threads: the conversation that authors a dashboard, its plans, and the custom parts its messages
 * carry (plan cards, new dashboard versions, diffs).
 */

import { queryLanguageSchema } from '@quanthea/plugin-kit/contract';
import { z } from 'zod';
import { connectorNameSchema } from './connectors.ts';
import { slugSchema } from './spec/names.ts';

/** Where a thread is: asking, waiting for plan approval, building, or ready for small edits. */
export const threadStates = ['idle', 'plan_pending', 'building', 'ready'] as const;

/** A thread state. */
export type ThreadState = (typeof threadStates)[number];

/** What a thread makes: a dashboard or an alert, chosen when it starts and fixed. */
export const threadKinds = ['dashboard', 'alert'] as const;

/** What a thread makes. */
export type ThreadKind = (typeof threadKinds)[number];

/** Validates the panel an alert thread starts from: its dashboard, version and id. */
export const alertSeedSchema = z.strictObject({
  dashboardId: z.string().min(1).max(100),
  version: z.int().min(1),
  panelId: slugSchema,
});

/** The panel an alert thread starts from. */
export type AlertSeed = z.infer<typeof alertSeedSchema>;

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

/**
 * Validates a plan: what the agent proposes to build, for a person to approve. A plan for an
 * existing draft, such as a copy of another dashboard, says how it changes it: the panels it
 * replaces, those it removes and the changes outside panels; the panels it leaves out stay.
 */
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
        /** The id of the draft's panel this one changes; a panel without it is new. */
        replaces: slugSchema.optional(),
        /** What changes in the replaced panel, in a few words. */
        change: z.string().min(1).max(200).optional(),
        /** The query the panel will run, when the settings ask plans to show it. */
        query: z.string().min(1).max(4000).optional(),
      }),
    )
    .min(1)
    .max(30),
  /** The ids of the draft's panels the plan drops. */
  removes: z.array(slugSchema).max(60).optional(),
  /** Changes outside panels, in words, such as `time range: last 7 days`. */
  changes: z.array(z.string().min(1).max(200)).max(10).optional(),
});

/** A plan. */
export type Plan = z.infer<typeof planSchema>;

/**
 * Validates an alert plan: what an alert thread proposes to watch, when it fires, how often it
 * checks and whom it notifies, in words, for a person to approve before the agent writes it.
 */
export const alertPlanSchema = z.strictObject({
  kind: z.literal('alert'),
  title: z.string().min(1).max(200),
  /** What it watches, such as `the 5xx share of requests, per service`. */
  watch: z.string().min(1).max(300),
  /** The connector it reads. */
  connector: connectorNameSchema,
  /** When it fires, such as `above 2% for 5 minutes`. */
  condition: z.string().min(1).max(300),
  /** How often it checks, such as `every minute`. */
  every: z.string().min(1).max(100),
  /** The channels it notifies, by id and name. */
  channels: z.array(z.object({ id: z.string().max(64), name: z.string().max(200) })).max(20),
  /** When it notifies, such as `on firing and resolved, again every 30 minutes`. */
  notify: z.string().max(300).optional(),
});

/** An alert plan. */
export type AlertPlan = z.infer<typeof alertPlanSchema>;

/**
 * Whether a plan is a dashboard plan, not an alert thread's.
 *
 * @param body - The plan.
 * @returns `true` for a dashboard plan.
 */
export function isDashboardPlan(body: Plan | AlertPlan): body is Plan {
  return !('kind' in body);
}

/** Validates a plan as the API returns it: a dashboard plan, or an alert thread's plan. */
export const planViewSchema = z.object({
  id: z.string(),
  status: z.enum(planStatuses),
  body: z.union([planSchema, alertPlanSchema]),
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

/**
 * Validates a write that failed its checks, or the write that worked after failures: which try it
 * was out of how many, the panels that failed and why, and the spec's other problems.
 */
const repairSchema = z.object({
  /** How many writes failed so far in this answer. */
  attempt: z.int().min(0),
  /** How many failed writes the answer may have before the agent stops. */
  of: z.int().min(0),
  /**
   * `failed`: nothing was saved and the agent tries again; `left-out`: saved without the new
   * panels that fail, which the agent adds again; `repaired`: this write worked after failures;
   * `exhausted`: it failed and no attempt is left.
   */
  outcome: z.enum(['failed', 'left-out', 'repaired', 'exhausted']),
  /** The panels that failed, with what is wrong with each. */
  panels: z
    .array(z.object({ id: z.string(), title: z.string(), problems: z.array(z.string()).max(10) }))
    .max(60),
  /** What is wrong with the dashboard as a whole, such as an invalid layout. */
  issues: z.array(z.string()).max(20),
});

/** A failed write, or the repaired one. */
export type Repair = z.infer<typeof repairSchema>;

/** Validates the change of one field of an alert spec, as the hand-edit card shows it. */
export const specChangeSchema = z.object({
  /** The field, such as `condition.value`. */
  path: z.string().max(200),
  before: z.string().max(2000).optional(),
  after: z.string().max(2000).optional(),
});

/** The change of one field of an alert spec. */
export type SpecChange = z.infer<typeof specChangeSchema>;

/** The custom parts of an alert thread. */
const alertDataSchemas = {
  /** A proposed alert plan, for the plan card. */
  alertPlan: z.object({ planId: z.string(), body: alertPlanSchema }),
  /** A new alert version; the draft pane moves to it. */
  alertVersion: z.object({ alertId: z.string(), version: z.int(), note: z.string() }),
  /** The person changed the draft by hand: the versions and the fields that changed. */
  handEdit: z.object({
    alertId: z.string(),
    from: z.int(),
    to: z.int(),
    changes: z.array(specChangeSchema).max(40),
  }),
  /** The agent offers to show the alert on a panel whose query matches; the person decides. */
  linkProposal: z.object({
    alertId: z.string(),
    dashboardId: z.string(),
    dashboardTitle: z.string(),
    panelId: z.string(),
    panelTitle: z.string(),
  }),
};

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
  /** A failed write, or the repaired one, for the build log. */
  repair: repairSchema,
  /** What changed from one version to the next, for the diff card. */
  diff: z.object({
    dashboardId: z.string(),
    from: z.int(),
    to: z.int(),
    panels: z.array(panelDiffSchema),
  }),
  ...alertDataSchemas,
};

/** The data of each custom part. */
export type ThreadData = {
  [Name in keyof typeof threadDataSchemas]: z.infer<(typeof threadDataSchemas)[Name]>;
};
