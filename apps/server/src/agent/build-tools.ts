/**
 * The tools that build: propose a plan, write a dashboard, patch one panel. The thread's state
 * machine decides whether each may run, whatever the model tries.
 */
import { type DashboardSpec, dashboardSpecSchema, planSchema } from '@querent/shared';
import { tool } from 'ai';
import { z } from 'zod';
import type { RunContext } from './run-context.ts';
import { type WriteResult, writeVersion } from './write-version.ts';

/**
 * The tool that proposes a plan.
 *
 * @param context - The run.
 * @returns The tool.
 */
function proposePlanTool(context: RunContext) {
  return tool({
    description:
      'Propose what you will build, before building it: a title, the variables and time range in words, and each panel with its kind, title, language and connector. The person approves it; then you build. Call it once, as your last action.',
    inputSchema: planSchema,
    execute: (plan) => {
      const autoApprove = !context.settings.behaviour.planApproval;
      const proposed = context.threads.proposePlan(context.threadId, plan, autoApprove);
      context.writer.write({
        type: 'data-plan',
        id: proposed.id,
        data: { planId: proposed.id, body: plan },
      });
      context.counters.planPending = !autoApprove;
      const next = autoApprove
        ? 'Approved. Build it now with write_dashboard.'
        : 'Waiting for the person to approve. Stop here.';
      return { planId: proposed.id, status: proposed.status, next };
    },
  });
}

/**
 * The tool that writes a whole dashboard.
 *
 * @param context - The run.
 * @returns The tool.
 */
function writeDashboardTool(context: RunContext) {
  return tool({
    description:
      'Write the whole dashboard spec as a new version. Only after the plan is approved, or to change existing panels. Every query is test-run first; a failing query is not saved, and you get the errors to fix. Keep panel ids stable across versions.',
    inputSchema: z.object({
      spec: z.record(z.string(), z.unknown()),
      changeSummary: z.string().min(1).max(200),
    }),
    execute: ({ spec, changeSummary }) => {
      const current = currentSpec(context);
      const ids = (value: unknown) =>
        new Set((value as DashboardSpec | undefined)?.panels?.map((panel) => panel.id) ?? []);
      const same = current !== undefined && sameIds(ids(current), ids(spec));
      return writeVersion(context, spec, changeSummary, same);
    },
  });
}

/**
 * The tool that changes one panel of the current version.
 *
 * @param context - The run.
 * @returns The tool.
 */
function patchPanelTool(context: RunContext) {
  return tool({
    description:
      'Change one existing panel of the current version: its title, description, grid, queries or view. Fields you leave out stay as they are. Use it for small edits, such as a panel the person mentions.',
    inputSchema: z.object({
      panelId: z.string(),
      changes: z.object({
        title: z.string().optional(),
        description: z.string().optional(),
        grid: z.record(z.string(), z.unknown()).optional(),
        queries: z.array(z.record(z.string(), z.unknown())).optional(),
        view: z.record(z.string(), z.unknown()).optional(),
      }),
      changeSummary: z.string().min(1).max(200),
    }),
    execute: async ({ panelId, changes, changeSummary }): Promise<WriteResult> => {
      const current = currentSpec(context);
      if (!current)
        return { ok: false, error: 'There is no dashboard yet. Write one with write_dashboard.' };
      if (!current.panels.some((panel) => panel.id === panelId))
        return { ok: false, error: `No panel "${panelId}".` };
      const panels = current.panels.map((panel) =>
        panel.id === panelId ? { ...panel, ...changes } : panel,
      );
      return writeVersion(context, { ...current, panels }, changeSummary, true);
    },
  });
}

/**
 * Whether two sets of panel ids are equal.
 *
 * @param first - One set.
 * @param second - The other.
 * @returns Whether they hold the same ids.
 */
function sameIds(first: ReadonlySet<string>, second: ReadonlySet<string>): boolean {
  return first.size === second.size && [...first].every((id) => second.has(id));
}

/**
 * The thread's latest dashboard version, if it has one.
 *
 * @param context - The run.
 * @returns The spec.
 */
export function currentSpec(context: RunContext): DashboardSpec | undefined {
  const { dashboardId } = context.threads.row(context.threadId);
  if (dashboardId === null) return undefined;
  const latest = context.dashboards.get(dashboardId, 'editor').versions.at(-1)?.version;
  if (latest === undefined) return undefined;
  return dashboardSpecSchema.parse(
    context.dashboards.getVersion(dashboardId, latest, 'editor').spec,
  );
}

/**
 * Creates the build tools of a run.
 *
 * @param context - The run.
 * @returns The tools.
 */
export function buildTools(context: RunContext) {
  return {
    propose_plan: proposePlanTool(context),
    write_dashboard: writeDashboardTool(context),
    patch_panel: patchPanelTool(context),
  };
}
