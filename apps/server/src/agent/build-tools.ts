/**
 * The tools that build: propose a plan, and edit the dashboard with panels of data and charts. The
 * thread's state machine decides whether each may run, whatever the model tries.
 */
import { type DashboardSpec, dashboardSpecSchema, type Plan, planSchema } from '@quanthea/shared';
import { tool } from 'ai';
import {
  applyEdit,
  type ChartChoices,
  completeCharts,
  type EditRequest,
  editRequestSchemaFor,
} from '../dashboards/panels/index.ts';
import { QueryError } from '../dashboards/queries/index.ts';
import { markerIssues, panelProblems } from './panel-problems.ts';
import type { RunContext } from './run-context.ts';
import { providerSchema } from './tool-schema.ts';
import { type WriteResult, writeVersion } from './write-version.ts';

/**
 * The panel ids a plan names that the draft does not have.
 *
 * @param plan - The plan.
 * @param draft - The current draft, if any.
 * @returns The unknown ids.
 */
function unknownPanels(plan: Plan, draft: DashboardSpec | undefined): string[] {
  const named = [
    ...plan.panels.flatMap((panel) => (panel.replaces === undefined ? [] : [panel.replaces])),
    ...(plan.removes ?? []),
  ];
  const known = new Set(draft?.panels.map((panel) => panel.id) ?? []);
  return [...new Set(named.filter((id) => !known.has(id)))];
}

/**
 * The tool that proposes a plan.
 *
 * @param context - The run.
 * @returns The tool.
 */
function proposePlanTool(context: RunContext) {
  return tool({
    description:
      'Propose what you will build, before building it: a title, the variables and time range in words, and each panel with its kind, title, language and connector. For an existing draft, mark the panels you change with replaces and change, and list the ones you drop in removes. The person approves it; then you build. Call it once, as your last action.',
    inputSchema: providerSchema(planSchema),
    execute: (plan) => {
      const unknown = unknownPanels(plan, currentSpec(context));
      if (unknown.length > 0)
        return {
          error: `The draft has no panel ${unknown.join(', ')}. Use the ids of the current draft's panels in replaces and removes.`,
        };
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
 * The spec an edit makes, or why it cannot.
 *
 * @param context - The run.
 * @param current - The current spec, if any.
 * @param request - The edit.
 * @returns The spec and the chart choice of each panel it builds, or the error.
 */
function edited(context: RunContext, current: DashboardSpec | undefined, request: EditRequest) {
  try {
    const dialectOf = (name: string) =>
      context.modelView.connectors().find((connector) => connector.name === name)?.dialect;
    return applyEdit(current, request, { saved: context.queries.saved, dialectOf });
  } catch (error) {
    if (!(error instanceof QueryError)) throw error;
    return { error: error.message };
  }
}

/**
 * The problems of a spec that are not about views: views are completed once the queries have run.
 *
 * @param context - The run.
 * @param spec - The spec.
 * @returns The problems.
 */
function problemsBeforeRun(context: RunContext, spec: DashboardSpec) {
  const checked = context.dashboards.check(spec);
  return checked.ok ? [] : checked.issues.filter((issue) => !/(^|\.)view(\.|$)/.test(issue.path));
}

/**
 * Makes the edit: builds the spec, test-runs it, completes the charts from the data, and writes the
 * panels that work.
 *
 * @param context - The run.
 * @param request - The edit.
 * @returns What the model learns.
 */
async function editDashboard(context: RunContext, request: EditRequest): Promise<WriteResult> {
  const current = currentSpec(context);
  const result = edited(context, current, request);
  if ('error' in result) return { ok: false, error: result.error };
  const issues = problemsBeforeRun(context, result.spec);
  if (issues.length > 0) return { ok: false, error: 'The dashboard is invalid.', issues };
  const tests = await context.dashboards.testRun(result.spec);
  const completion = completeCharts(result.spec, result.charts as ChartChoices, tests);
  const before = current ? idsOf(current) : new Set<string>();
  const added = new Set([...idsOf(completion.spec)].filter((id) => !before.has(id)));
  const samePanels = current !== undefined && sameIds(before, idsOf(completion.spec));
  const run = {
    tests,
    panelProblems: panelProblems(current, completion.spec, completion.problems),
    ...(request.markers ? { markerIssues: markerIssues(completion.spec, tests) } : {}),
  };
  return writeVersion(context, completion.spec, request.summary, samePanels, added, run);
}

/**
 * The tool that changes the dashboard: its settings, panels of data and charts, and deploy markers.
 *
 * @param context - The run.
 * @returns The tool.
 */
function editDashboardTool(context: RunContext) {
  return tool({
    description:
      'Change the dashboard in one new version: set its title, time range and variables; add panels, each data (a query builder, a saved query or a raw query) and a chart recipe; rebuild a panel in place (replaces); remove panels; set deploy markers. The server writes and test-runs the queries, fills each chart from the columns the data returns, and saves the panels that work; otherwise you get the errors to fix.',
    inputSchema: providerSchema(editRequestSchemaFor(context.queries, context.charts)),
    execute: (request) => editDashboard(context, request),
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
