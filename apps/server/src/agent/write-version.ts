/**
 * Writes a dashboard version for the agent: checks the thread may write, validates the spec,
 * test-runs every panel, and saves only a version whose panels all work. The results the model
 * sees pass through the gate.
 */
import { type DashboardSpec, diffSpecs, type PanelDiff } from '@querent/shared';
import type { PanelTest } from '../dashboards/dashboards.ts';
import type { ModelTestResult } from '../gate/test-run.ts';
import { canWrite } from '../threads/state.ts';
import type { RunContext } from './run-context.ts';

/** What the model learns from a write. */
export type WriteResult =
  | { readonly ok: true; readonly version: number; readonly panels: readonly PanelReport[] }
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
}

/**
 * Shapes the test runs for the model through the gate.
 *
 * @param context - The run.
 * @param spec - The spec, for each query's connector.
 * @param tests - The test runs.
 * @returns One report per panel.
 */
function reportsOf(
  context: RunContext,
  spec: DashboardSpec,
  tests: readonly PanelTest[],
): PanelReport[] {
  return tests.map((test) => {
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
    return { panelId: test.panelId, queries };
  });
}

/**
 * Why the thread may not write now, if it may not.
 *
 * @param context - The run.
 * @param onlyExistingPanels - Whether the change keeps the set of panels.
 * @returns The reason, or `undefined` when the write may go ahead.
 */
function refusal(context: RunContext, onlyExistingPanels: boolean): string | undefined {
  const { state } = context.threads.row(context.threadId);
  if (canWrite(state, onlyExistingPanels)) return undefined;
  if (state === 'plan_pending') return 'A plan waits for approval. Stop and let the person decide.';
  return 'Propose a plan with propose_plan first. Only a change to existing panels skips the plan.';
}

/**
 * Counts a failed write and says whether the run may still repair.
 *
 * @param context - The run.
 * @param error - What went wrong.
 * @returns The failure the model sees.
 */
function failed(context: RunContext, error: string): { ok: false; error: string } {
  context.counters.failedWrites += 1;
  const left = context.settings.limits.repairAttempts - context.counters.failedWrites;
  const next =
    left > 0
      ? `Fix it and write again (${left} attempts left).`
      : 'No attempts left: stop and explain the problem.';
  return { ok: false, error: `${error} ${next}` };
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
 * Writes a version for the agent.
 *
 * @param context - The run.
 * @param input - The spec, as the model wrote it.
 * @param changeSummary - What changed, in one line.
 * @param onlyExistingPanels - Whether the change keeps the set of panels.
 * @returns The result the model sees.
 */
export async function writeVersion(
  context: RunContext,
  input: unknown,
  changeSummary: string,
  onlyExistingPanels: boolean,
): Promise<WriteResult> {
  const refused = refusal(context, onlyExistingPanels);
  if (refused !== undefined) return { ok: false, error: refused };
  const checked = context.dashboards.check(input);
  if (!checked.ok) return { ...failed(context, 'The spec is invalid.'), issues: checked.issues };
  const tests = await context.dashboards.testRun(checked.spec);
  const panels = reportsOf(context, checked.spec, tests);
  const broken = panels.some((panel) => panel.queries.some((query) => !query.ok));
  if (broken && context.settings.behaviour.testRun)
    return { ...failed(context, 'Some queries fail.'), panels };
  const version = save(context, checked.spec, changeSummary);
  context.threads.apply(context.threadId, 'built');
  return { ok: true, version, panels };
}
