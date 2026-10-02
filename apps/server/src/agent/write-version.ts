/**
 * Writes a dashboard version for the agent, from the test run the edit made: checks the thread may
 * write, and saves only panels that work. New panels whose queries fail, or whose chart does not
 * fit their data, are left out of the version and reported, so the model re-adds only those; any
 * other failure keeps the version from being saved. The results the model sees pass through the
 * gate.
 */
import { type DashboardSpec, diffSpecs, type PanelDiff, type Repair } from '@quanthea/shared';
import type { PanelTest } from '../dashboards/dashboards.ts';
import { compactGrid } from '../dashboards/panels/index.ts';
import type { ModelTestResult } from '../gate/test-run.ts';
import { canWrite } from '../threads/state.ts';
import type { RunContext } from './run-context.ts';

/** What the model learns from a write. */
export type WriteResult =
  | {
      readonly ok: true;
      readonly version: number;
      readonly panels: readonly PanelReport[];
      /** New panels left out because their queries failed, and what to do. */
      readonly leftOut?: { readonly panelIds: readonly string[]; readonly next: string };
    }
  | {
      readonly ok: false;
      readonly error: string;
      readonly issues?: readonly { path: string; message: string }[];
      readonly panels?: readonly PanelReport[];
    };

/** One panel's test run, as the model may see it. */
interface PanelReport {
  /** The panel. */
  readonly panelId: string;
  /** Each query's result, shaped by the gate. */
  readonly queries: readonly ({ readonly refId: string } & ModelTestResult)[];
  /**
   * What is wrong with the panel beyond its queries' errors, if anything: its chart for the data
   * the queries returned, or a query that names a fixed time.
   */
  readonly problems?: readonly string[];
}

/** The test run an edit made before writing, and the other problems of each panel. */
export interface WriteRun {
  /** The test run of each panel. */
  readonly tests: readonly PanelTest[];
  /** What is wrong with each panel beyond its queries' errors, by panel id. */
  readonly panelProblems: ReadonlyMap<string, readonly string[]>;
}

/**
 * Shapes the test runs for the model through the gate.
 *
 * @param context - The run.
 * @param spec - The spec, for each query's connector.
 * @param run - The test runs and the chart problems.
 * @returns One report per panel.
 */
function reportsOf(context: RunContext, spec: DashboardSpec, run: WriteRun): PanelReport[] {
  return run.tests.map((test) => {
    const panel = spec.panels.find((each) => each.id === test.panelId);
    const queries = test.run.queries.map((outcome) => {
      const connector =
        panel?.queries.find((query) => query.refId === outcome.refId)?.connector ?? '';
      const error = outcome.error?.message ?? null;
      return {
        refId: outcome.refId,
        ...context.modelView.panelResult(connector, { frames: outcome.frames, error }),
      };
    });
    const problems = run.panelProblems.get(test.panelId);
    return { panelId: test.panelId, queries, ...(problems ? { problems } : {}) };
  });
}

/**
 * Why the thread may not write now, if it may not.
 *
 * @param context - The run.
 * @param onlyExistingPanels - Whether the change keeps the set of panels.
 * @param added - How many panels the change adds.
 * @returns The reason, or `undefined` when the write may go ahead.
 */
function refusal(
  context: RunContext,
  onlyExistingPanels: boolean,
  added: number,
): string | undefined {
  const { state } = context.threads.row(context.threadId);
  if (canWrite(state, onlyExistingPanels)) return undefined;
  // Panels of the approved plan left out earlier in this run may come back without a new plan.
  if (state === 'ready' && context.counters.leftOut > 0 && added <= context.counters.leftOut)
    return undefined;
  if (state === 'plan_pending') return 'A plan waits for approval. Stop and let the person decide.';
  return 'Propose a plan with propose_plan first. Only a change to existing panels skips the plan.';
}

/**
 * Counts a failed write and says what the model does next.
 *
 * @param context - The run.
 * @param fix - What to do while attempts are left, such as `Fix it and write again`.
 * @returns The next step, with the attempts left.
 */
function nextAttempt(context: RunContext, fix: string): string {
  context.counters.failedWrites += 1;
  const left = context.settings.limits.repairAttempts - context.counters.failedWrites;
  return left > 0
    ? `${fix} (${left} attempts left).`
    : 'No attempts left: stop and explain the problem.';
}

/**
 * A failed write, counted.
 *
 * @param context - The run.
 * @param error - What went wrong.
 * @returns The failure the model sees.
 */
function failed(context: RunContext, error: string): { ok: false; error: string } {
  return { ok: false, error: `${error} ${nextAttempt(context, 'Fix it and write again')}` };
}

/**
 * A panel diff as the diff card's data: missing values left out rather than `undefined`.
 *
 * @param panel - The panel diff.
 * @returns The data.
 */
function diffData(panel: PanelDiff) {
  const changes = panel.changes.map(({ path, before, after }) => ({
    path,
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
  }));
  return { id: panel.id, title: panel.title, status: panel.status, changes };
}

/**
 * Saves the spec as the thread's next version, and streams the version and its diff.
 *
 * @param context - The run.
 * @param spec - The valid spec.
 * @param changeSummary - What changed, in one line.
 * @returns The new version number.
 */
function save(context: RunContext, spec: DashboardSpec, changeSummary: string): number {
  const { threads, dashboards, threadId, actor, writer } = context;
  const { dashboardId } = threads.row(threadId);
  if (dashboardId === null) {
    const created = dashboards.create(spec, changeSummary, actor);
    threads.attachDashboard(threadId, created.id, spec.title);
    writer.write({
      type: 'data-version',
      data: { dashboardId: created.id, version: 1, summary: changeSummary },
    });
    return 1;
  }
  const previous = dashboards.get(dashboardId, 'editor').versions.at(-1)?.version ?? 0;
  const version = dashboards.addVersion(dashboardId, spec, changeSummary, actor);
  writer.write({ type: 'data-version', data: { dashboardId, version, summary: changeSummary } });
  const before =
    previous > 0 ? dashboards.getVersion(dashboardId, previous, 'editor').spec : undefined;
  const panels = before
    ? diffSpecs(before, spec).panels.filter((panel) => panel.status !== 'same')
    : [];
  writer.write({
    type: 'data-diff',
    data: { dashboardId, from: previous, to: version, panels: panels.map(diffData) },
  });
  return version;
}

/**
 * The panels that do not work: they have a problem, such as a chart that does not fit their data
 * or a query on a fixed time, or, when every query is test-run, a query fails.
 *
 * @param panels - The reports.
 * @param testRun - Whether failing queries count.
 * @returns Their ids.
 */
function failingPanels(panels: readonly PanelReport[], testRun: boolean): string[] {
  return panels
    .filter(
      (panel) =>
        panel.problems !== undefined || (testRun && panel.queries.some((query) => !query.ok)),
    )
    .map((panel) => panel.panelId);
}

/**
 * The spec to save when some queries fail: without the failing panels when they are all new and
 * some panels remain, or nothing when the write must fail.
 *
 * @param spec - The checked spec.
 * @param failing - The ids of the failing panels.
 * @param droppable - The ids of the panels the write adds.
 * @returns The spec without the failing panels, or `undefined`.
 */
function withoutFailing(
  spec: DashboardSpec,
  failing: readonly string[],
  droppable: ReadonlySet<string>,
): DashboardSpec | undefined {
  if (!failing.every((id) => droppable.has(id))) return undefined;
  const panels = spec.panels.filter((panel) => !failing.includes(panel.id));
  return panels.length === 0 ? undefined : { ...spec, panels: compactGrid(panels) };
}

/**
 * Saves a version and moves the thread on.
 *
 * @param context - The run.
 * @param spec - The spec to save.
 * @param changeSummary - What changed.
 * @returns The version number.
 */
function saveBuilt(context: RunContext, spec: DashboardSpec, changeSummary: string): number {
  const version = save(context, spec, changeSummary);
  context.threads.apply(context.threadId, 'built');
  return version;
}

/**
 * What is wrong with one panel, as the build log shows it: each failing query, then the chart.
 *
 * @param report - The panel's report.
 * @returns The problems, at most ten.
 */
function problemsOf(report: PanelReport): string[] {
  const queries = report.queries.flatMap((query) => (query.ok ? [] : [query.error]));
  return [...queries, ...(report.problems ?? [])].slice(0, 10);
}

/** What a repair part says about one write. */
interface RepairNote {
  /** What happened: `exhausted` is derived when no attempt is left. */
  readonly kind: 'failed' | 'left-out' | 'repaired';
  /** The spec, for the panels' titles. */
  readonly spec: DashboardSpec;
  /** The test run of each panel. */
  readonly panels?: readonly PanelReport[];
  /** The ids of the panels that failed. */
  readonly failing?: readonly string[];
  /** The spec's other problems. */
  readonly issues?: readonly { readonly path: string; readonly message: string }[];
}

/**
 * Streams a failed write, or the write that worked after failures, for the build log.
 *
 * @param context - The run, after the failure was counted.
 * @param note - What happened.
 */
function writeRepair(context: RunContext, note: RepairNote): void {
  const attempt = context.counters.failedWrites;
  const of = context.settings.limits.repairAttempts;
  const outcome: Repair['outcome'] =
    note.kind !== 'repaired' && attempt >= of ? 'exhausted' : note.kind;
  const failing = new Set(note.failing ?? []);
  const panels = (note.panels ?? [])
    .filter((report) => failing.has(report.panelId))
    .map((report) => ({
      id: report.panelId,
      title: note.spec.panels.find((panel) => panel.id === report.panelId)?.title ?? report.panelId,
      problems: problemsOf(report),
    }));
  const issues = (note.issues ?? []).map(({ path, message }) => `${path}: ${message}`).slice(0, 20);
  context.writer.write({ type: 'data-repair', data: { attempt, of, outcome, panels, issues } });
}

/**
 * Saves a version that kept every panel, and says so in the build log when it repaired a failure.
 *
 * @param context - The run.
 * @param spec - The spec to save.
 * @param changeSummary - What changed.
 * @returns The version number.
 */
function saveWhole(context: RunContext, spec: DashboardSpec, changeSummary: string): number {
  const version = saveBuilt(context, spec, changeSummary);
  if (context.counters.failedWrites > 0) writeRepair(context, { kind: 'repaired', spec });
  return version;
}

/**
 * Fails a write whose panels or spec do not work, counted, and streams it for the build log.
 *
 * @param context - The run.
 * @param spec - The spec the edit made.
 * @param panels - The panel reports.
 * @param failing - The ids of the failing panels.
 * @returns The result the model sees.
 */
function failWrite(
  context: RunContext,
  spec: DashboardSpec,
  panels: readonly PanelReport[],
  failing: readonly string[],
): WriteResult {
  const result = { ...failed(context, 'Some panels do not work.'), panels };
  writeRepair(context, { kind: 'failed', spec, panels, failing });
  return result;
}

/**
 * Writes a version for the agent.
 *
 * @param context - The run.
 * @param spec - The spec the edit made, its charts completed from the test run.
 * @param changeSummary - What changed, in one line.
 * @param onlyExistingPanels - Whether the change keeps the set of panels.
 * @param droppable - New panels that may be left out when they do not work.
 * @param run - The test run and the chart problems.
 * @returns The result the model sees.
 */
export function writeVersion(
  context: RunContext,
  spec: DashboardSpec,
  changeSummary: string,
  onlyExistingPanels: boolean,
  droppable: ReadonlySet<string>,
  run: WriteRun,
): WriteResult {
  const refused = refusal(context, onlyExistingPanels, droppable.size);
  if (refused !== undefined) return { ok: false, error: refused };
  const panels = reportsOf(context, spec, run);
  const failing = failingPanels(panels, context.settings.behaviour.testRun);
  const kept = failing.length === 0 ? spec : withoutFailing(spec, failing, droppable);
  if (!kept) return failWrite(context, spec, panels, failing);
  const checked = context.dashboards.check(kept);
  if (!checked.ok) {
    const result = { ...failed(context, 'The spec is invalid.'), issues: checked.issues, panels };
    writeRepair(context, { kind: 'failed', spec, panels, failing, issues: checked.issues });
    return result;
  }
  context.counters.leftOut =
    Math.max(0, context.counters.leftOut - droppable.size) + failing.length;
  if (failing.length === 0)
    return { ok: true, version: saveWhole(context, checked.spec, changeSummary), panels };
  const version = saveBuilt(context, checked.spec, changeSummary);
  const next = `These new panels were left out because they do not work. ${nextAttempt(context, 'Fix them and add them again')}`;
  writeRepair(context, { kind: 'left-out', spec, panels, failing });
  return { ok: true, version, panels, leftOut: { panelIds: failing, next } };
}
