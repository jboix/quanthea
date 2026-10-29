/**
 * Checks a draft panel a person edited by hand, as the agent's writes are checked: the spec's
 * schema, theme tokens and references, a query that names a fixed time, and a test run of the
 * panel's queries. A chart picked from the recipes replaces the view, completed from the test
 * run's data. Nothing is saved here.
 */
import {
  type DashboardSpec,
  fixedTimeOf,
  type HandChart,
  type Panel,
  type PanelTestOutcome,
} from '@quanthea/shared';
import { AppError } from '../lib/errors.ts';
import type { Dashboards, PanelTest } from './dashboards.ts';
import type { SpecIssue } from './issues.ts';
import { completeCharts } from './panels/index.ts';

/** What a hand edit needs of the dashboards: the checks of a write and the test run. */
type Checks = Pick<Dashboards, 'check' | 'testRun'>;

/** A hand edit of one panel of a spec. */
export interface HandEditInput {
  /** The latest spec, which the edit starts from. */
  readonly current: DashboardSpec;
  /** The panel edited. */
  readonly panelId: string;
  /** The whole panel as the person left it. */
  readonly panel: unknown;
  /** A chart from the recipes, which replaces the view. */
  readonly chart?: HandChart | undefined;
}

/** A checked hand edit: the outcome the person sees, and the spec to save when it passed. */
export interface CheckedHandEdit {
  /** The outcome, at paths inside the panel. */
  readonly outcome: PanelTestOutcome;
  /** The spec with the edited panel, when the outcome is ok. */
  readonly spec?: DashboardSpec | undefined;
}

/**
 * The spec with the edited panel in place. The panel keeps its id, and its place on the grid
 * unless the edit gives one.
 *
 * @param input - The edit.
 * @returns The spec, unchecked, and the panel's index.
 * @throws {AppError} `not_found` for a panel the draft does not have.
 */
function withPanel(input: HandEditInput): { spec: DashboardSpec; index: number } {
  const index = input.current.panels.findIndex((panel) => panel.id === input.panelId);
  const before = input.current.panels[index];
  if (!before) throw new AppError('not_found', `The draft has no panel ${input.panelId}.`);
  const given = typeof input.panel === 'object' && input.panel !== null ? input.panel : {};
  const panel = { grid: before.grid, ...given, id: before.id } as Panel;
  const panels = input.current.panels.map((each, at) => (at === index ? panel : each));
  return { spec: { ...input.current, panels }, index };
}

/**
 * Moves an issue's path inside the panel: `panels[2].queries[0].sql` becomes `queries[0].sql`.
 * An issue elsewhere in the spec keeps its path.
 *
 * @param issue - The issue.
 * @param index - The panel's index.
 * @returns The issue.
 */
function inPanel(issue: SpecIssue, index: number): SpecIssue {
  const prefix = `panels[${index}]`;
  if (!issue.path.startsWith(prefix)) return issue;
  const path = issue.path.slice(prefix.length).replace(/^\./, '') || 'panel';
  return { path, message: issue.message };
}

/**
 * The spec's issues, at paths inside the panel; with a chart picked, the view's are left for after
 * the test run, which completes it.
 *
 * @param checks - The dashboards' checks.
 * @param spec - The spec.
 * @param index - The panel's index.
 * @param picked - Whether a chart replaces the view.
 * @returns The issues.
 */
function issuesOf(checks: Checks, spec: DashboardSpec, index: number, picked: boolean) {
  const checked = checks.check(spec);
  if (checked.ok) return [];
  const issues = checked.issues.map((issue) => inPanel(issue, index));
  return picked ? issues.filter((issue) => !/^view(\.|\[|$)/.test(issue.path)) : issues;
}

/**
 * The queries that name a fixed time instead of following the dashboard's range, among those the
 * edit changed.
 *
 * @param before - The panel before the edit.
 * @param after - The panel after it.
 * @returns The issues.
 */
function fixedTimes(before: Panel | undefined, after: Panel): SpecIssue[] {
  return after.queries.flatMap((query, at) => {
    const was = before?.queries.find((each) => each.refId === query.refId);
    if (JSON.stringify(was) === JSON.stringify(query)) return [];
    const why = fixedTimeOf(query);
    return why ? [{ path: `queries[${at}]`, message: why }] : [];
  });
}

/**
 * What each query returned on the test run.
 *
 * @param test - The panel's test run.
 * @returns The rows or the error of each query.
 */
function queryOutcomes(test: PanelTest | undefined): PanelTestOutcome['queries'] {
  return (test?.run.queries ?? []).map((outcome) => {
    const rows = outcome.frames.reduce((sum, frame) => sum + frame.meta.rowCount, 0);
    return outcome.error
      ? { refId: outcome.refId, rows: 0, error: outcome.error.message }
      : { refId: outcome.refId, rows };
  });
}

/**
 * The spec with the picked chart completed from the test run, and the chart's problems.
 *
 * @param spec - The spec.
 * @param input - The edit, with the chart.
 * @param tests - The test run.
 * @returns The completed spec and its problems at the view.
 */
function withChart(spec: DashboardSpec, input: HandEditInput, tests: readonly PanelTest[]) {
  if (!input.chart) return { spec, issues: [] };
  const charts = new Map([[input.panelId, { choice: input.chart, columns: [] }]]);
  const completion = completeCharts(spec, charts, tests);
  const problems = completion.problems.get(input.panelId) ?? [];
  return { spec: completion.spec, issues: problems.map((message) => ({ path: 'view', message })) };
}

/**
 * Checks a hand-edited panel and test-runs its queries.
 *
 * @param checks - The dashboards' checks and test run.
 * @param input - The edit.
 * @returns The outcome, and the spec to save when it passed.
 * @throws {AppError} `not_found` for a panel the draft does not have.
 */
export async function checkHandEdit(
  checks: Checks,
  input: HandEditInput,
): Promise<CheckedHandEdit> {
  const { spec, index } = withPanel(input);
  const early = issuesOf(checks, spec, index, input.chart !== undefined);
  if (early.length > 0) return { outcome: { ok: false, issues: early, queries: [] } };
  const panel = spec.panels[index] as Panel;
  const tests = await checks.testRun({ ...spec, panels: [panel] });
  const completed = withChart(spec, input, tests);
  const edited = completed.spec.panels[index] as Panel;
  const issues = [
    ...completed.issues,
    ...(completed.issues.length > 0 ? [] : issuesOf(checks, completed.spec, index, false)),
    ...fixedTimes(input.current.panels[index], edited),
  ];
  const queries = queryOutcomes(tests[0]);
  const ok = issues.length === 0 && queries.every((query) => query.error === undefined);
  const outcome = { ok, issues, queries, panel: edited };
  return ok ? { outcome, spec: completed.spec } : { outcome };
}
