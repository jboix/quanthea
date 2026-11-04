/**
 * Builds the panels of an edit, the one path every writer of panels takes: a dashboard's
 * `edit_dashboard` and a report's `edit_report`. The edit's panels of data and charts become a
 * spec, the spec is checked views aside, every panel is test-run, and each chart is completed from
 * its data, and each table it adds takes the height of its rows. What to save, and how, is the
 * writer's.
 */
import { type DashboardSpec, isDashboardPlan } from '@quanthea/shared';
import {
  applyEdit,
  type ChartChoices,
  completeCharts,
  type EditRequest,
  fitTableHeights,
} from '../dashboards/panels/index.ts';
import { QueryError } from '../dashboards/queries/index.ts';
import { derivedFrom } from '../gate/panel-results.ts';
import { atMarkerSets, markerIssues, panelProblems } from './panel-problems.ts';
import type { RunContext } from './run-context.ts';
import type { WriteRun } from './write-version.ts';

/** The panels an edit built, test-run and completed. */
export interface BuiltPanels {
  /** The spec, its charts completed from the test run. */
  readonly spec: DashboardSpec;
  /** The test run and the problems of each panel and set of markers. */
  readonly run: WriteRun;
  /** The ids of the panels the edit adds. */
  readonly added: ReadonlySet<string>;
}

/** Why an edit could not be built: what is wrong, and the issues by path. */
export interface BuildRefusal {
  /** Always false. */
  readonly ok: false;
  /** What is wrong. */
  readonly error: string;
  /** The spec's issues, by path. */
  readonly issues?: readonly { path: string; message: string }[];
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
 * The edit, with the approved plan's title when it starts a dashboard and gives none: the person
 * approved that title, so the first write never fails for the lack of one.
 *
 * @param context - The run.
 * @param current - The current spec, if any.
 * @param request - The edit.
 * @returns The edit.
 */
function withPlanTitle(
  context: RunContext,
  current: DashboardSpec | undefined,
  request: EditRequest,
): EditRequest {
  if (current || request.title !== undefined) return request;
  const { plans } = context.threads.get(context.threadId);
  const approved = plans.findLast((plan) => plan.status === 'approved')?.body;
  return approved && isDashboardPlan(approved) ? { ...request, title: approved.title } : request;
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
    const { definitions } = context;
    const titled = withPlanTitle(context, current, request);
    return applyEdit(current, titled, { saved: context.queries.saved, dialectOf, definitions });
  } catch (error) {
    if (!(error instanceof QueryError)) throw error;
    return { error: error.message };
  }
}

/**
 * The problems of a spec that are not about views: views are completed once the queries have run.
 * Those of a set of markers the edit sets are at that set, such as `markers[1]`.
 *
 * @param context - The run.
 * @param spec - The spec.
 * @param request - The edit, for its sets of markers.
 * @returns The problems.
 */
function problemsBeforeRun(context: RunContext, spec: DashboardSpec, request: EditRequest) {
  const checked = context.dashboards.check(spec);
  if (checked.ok) return [];
  const issues = checked.issues.filter((issue) => !/(^|\.)view(\.|$)/.test(issue.path));
  return atMarkerSets(spec, request.markers, issues);
}

/**
 * The charts of a built spec completed from its test run, each from the part of its result the
 * model may see.
 *
 * @param context - The run.
 * @param spec - The built spec.
 * @param charts - The chart choice of each panel it builds.
 * @param tests - Its test run.
 * @returns The completed spec and the problems.
 */
function completed(
  context: RunContext,
  spec: DashboardSpec,
  charts: ChartChoices,
  tests: Awaited<ReturnType<RunContext['dashboards']['testRun']>>,
) {
  return completeCharts(spec, charts, tests, (panel, outcome) =>
    context.modelView.visibleFrames(
      panel.queries[0]?.connector ?? '',
      outcome.frames,
      derivedFrom(panel, outcome),
    ),
  );
}

/**
 * Builds an edit's panels over the current spec: builds the spec, checks it views aside, test-runs
 * every panel over the spec's time range, completes the charts from the data, and fits the height
 * of each table it adds to its rows.
 *
 * @param context - The run.
 * @param current - The current spec, if any; its time range is the test run's.
 * @param request - The edit.
 * @param invalid - What a refusal says when the spec has issues, such as `The dashboard is invalid.`
 * @returns The built panels, or why the edit could not be built.
 */
export async function buildPanels(
  context: RunContext,
  current: DashboardSpec | undefined,
  request: EditRequest,
  invalid: string,
): Promise<BuiltPanels | BuildRefusal> {
  const result = edited(context, current, request);
  if ('error' in result) return { ok: false, error: result.error };
  const issues = problemsBeforeRun(context, result.spec, request);
  if (issues.length > 0) return { ok: false, error: invalid, issues };
  const tests = await context.dashboards.testRun(result.spec);
  const completion = completed(context, result.spec, result.charts as ChartChoices, tests);
  const before = current ? idsOf(current) : new Set<string>();
  const added = new Set([...idsOf(completion.spec)].filter((id) => !before.has(id)));
  const spec = fitTableHeights(completion.spec, tests, added);
  const run = {
    tests,
    panelProblems: panelProblems(current, spec, completion.problems),
    ...(request.markers.length > 0
      ? { markerIssues: markerIssues(spec, request.markers, tests) }
      : {}),
  };
  return { spec, run, added };
}
