/**
 * The tools that build: propose a plan, and edit the dashboard by recipe. The thread's state
 * machine decides whether each may run, whatever the model tries.
 */
import { type DashboardSpec, dashboardSpecSchema, planSchema } from '@querent/shared';
import { tool } from 'ai';
import { applyEdit, editRequestSchemaFor, RecipeError } from '../dashboards/recipes/index.ts';
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
        ? 'Approved. Build it now with edit_dashboard.'
        : 'Waiting for the person to approve. Stop here.';
      return { planId: proposed.id, status: proposed.status, next };
    },
  });
}

/**
 * The panel ids of a spec.
 *
 * @param spec - The spec.
 * @returns The ids.
 */
function idsOf(spec: DashboardSpec): Set<string> {
  return new Set(spec.panels.map((panel) => panel.id));
}

/**
 * The tool that changes the dashboard: its settings, panels by recipe, and deploy markers.
 *
 * @param context - The run.
 * @returns The tool.
 */
function editDashboardTool(context: RunContext) {
  return tool({
    description:
      'Change the dashboard in one new version: set its title, time range and variables, add panels by recipe, rebuild a panel in place (replaces), remove panels, set deploy markers. The server writes the queries, places the panels, and test-runs every query; the version is saved only when all of them work, otherwise you get the errors to fix.',
    inputSchema: editRequestSchemaFor(context.recipes),
    execute: async (request): Promise<WriteResult> => {
      const current = currentSpec(context);
      let spec: DashboardSpec;
      try {
        spec = applyEdit(current, request, context.recipes.saved);
      } catch (error) {
        if (!(error instanceof RecipeError)) throw error;
        return { ok: false, error: error.message };
      }
      const before = current ? idsOf(current) : new Set<string>();
      const added = new Set([...idsOf(spec)].filter((id) => !before.has(id)));
      const samePanels = current !== undefined && sameIds(before, idsOf(spec));
      return writeVersion(context, spec, request.summary, samePanels, added);
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
    edit_dashboard: editDashboardTool(context),
  };
}
