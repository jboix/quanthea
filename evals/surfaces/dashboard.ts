/**
 * The dashboard surface: a thread that builds a dashboard. A case's turns are talked through, then
 * the last version is read, its queries are run again, and what each panel returned is kept small.
 */
import type { DashboardSpec, Panel, PanelRun } from '@quanthea/shared';
import type { BuiltPanel, Outcome } from '../checks/dashboard.ts';
import type { Given, ThreadInput } from '../core/case.ts';
import type { Acted } from '../core/result.ts';
import { type EvalWorld, evalsActor } from '../world/setup.ts';
import { type AskedPanel, askedFields, askedOf } from './asked.ts';
import { panelResults } from './panel-results.ts';
import { messagesOf, talk, tally, toolTrace } from './thread.ts';

/**
 * The last version of the thread's dashboard, if it has one.
 *
 * @param world - The world.
 * @param threadId - The thread.
 * @returns Its spec.
 */
function lastSpec(world: EvalWorld, threadId: string): DashboardSpec | undefined {
  const { dashboardId } = world.services.threads.get(threadId);
  if (dashboardId === null) return undefined;
  const latest = world.services.dashboards.get(dashboardId, 'editor').versions.at(-1)?.version;
  if (latest === undefined) return undefined;
  return world.services.dashboards.getVersion(dashboardId, latest, 'editor').spec;
}

/**
 * The names of a panel's table operations, in order.
 *
 * @param panel - The panel.
 * @returns The field to spread; none for a panel without operations.
 */
function operationsField(panel: Panel): Pick<BuiltPanel, 'operations'> {
  const { operations } = panel as { operations?: readonly { readonly op: string }[] };
  if (!operations || operations.length === 0) return {};
  return { operations: operations.map((operation) => operation.op) };
}

/**
 * A spec's panels, as the scoring reads them.
 *
 * @param spec - The spec.
 * @param asked - What the agent asked the edit tool for, by panel.
 * @returns The panels.
 */
export function panelsOf(
  spec: DashboardSpec | undefined,
  asked: ReadonlyMap<string, AskedPanel> = new Map(),
): BuiltPanel[] {
  return (spec?.panels ?? []).map((panel) => ({
    id: panel.id,
    title: panel.title,
    connectors: [...new Set(panel.queries.map((query) => query.connector))],
    text: `${panel.title}\n${JSON.stringify(panel.queries)}`,
    kind: panel.view.kind,
    grid: panel.grid,
    queries: panel.queries,
    view: panel.view,
    ...(panel.definition ? { definition: panel.definition.id } : {}),
    ...operationsField(panel),
    ...askedFields(panel, asked),
  }));
}

/**
 * A spec's marker sets, each shaped like a panel for the scoring: its label and query.
 *
 * @param spec - The spec.
 * @returns One entry per annotation, in the spec's order; none when it has none.
 */
function markersOf(spec: DashboardSpec | undefined): BuiltPanel[] {
  return (spec?.annotations ?? []).map((annotation) => {
    const title = `Markers: ${annotation.label}`;
    const text = `${title}\n${JSON.stringify([annotation.query])}`;
    return { id: annotation.id, title, connectors: [annotation.query.connector], text };
  });
}

/**
 * The outcome's markers field: the marker sets when the spec has any, else nothing.
 *
 * @param spec - The spec.
 * @returns The field to spread.
 */
function markersField(spec: DashboardSpec | undefined): { markers?: BuiltPanel[] } {
  const markers = markersOf(spec);
  return markers.length > 0 ? { markers } : {};
}

/**
 * The outcome's dashboard field: the last version around its panels and markers, such as its
 * variables, for what an expectation asks of the dashboard as a whole.
 *
 * @param spec - The spec.
 * @returns The field to spread; none when nothing was built.
 */
function dashboardField(spec: DashboardSpec | undefined): Pick<Outcome, 'dashboard'> {
  if (!spec) return {};
  const { panels: _panels, annotations: _annotations, ...dashboard } = spec;
  return { dashboard };
}

/** One panel's run again. */
type PanelTest = { readonly panelId: string; readonly run: PanelRun };

/**
 * The queries of some runs that failed.
 *
 * @param tests - Each panel's run.
 * @returns The failures, by panel.
 */
function failingOf(tests: readonly PanelTest[]) {
  return tests.flatMap((test) =>
    test.run.queries.flatMap((query) =>
      query.error ? [{ panelId: test.panelId, error: query.error.message }] : [],
    ),
  );
}

/**
 * What the last version holds and returns: its panels, its markers, the dashboard around them,
 * the queries that fail when run again, and each panel's results.
 *
 * @param world - The world.
 * @param spec - The last version, if the thread has one.
 * @param asked - What the agent asked the edit tool for, by panel.
 * @returns The fields of the evidence they fill.
 */
async function builtOf(
  world: EvalWorld,
  spec: DashboardSpec | undefined,
  asked: ReadonlyMap<string, AskedPanel>,
) {
  const tests = spec ? await world.services.dashboards.testRun(spec) : [];
  return {
    panels: panelsOf(spec, asked),
    ...markersField(spec),
    ...dashboardField(spec),
    failing: failingOf(tests),
    ...(spec ? { results: panelResults(spec, tests) } : {}),
  };
}

/**
 * Talks a case's turns through and reads what came of it.
 *
 * @param world - The world.
 * @param given - What the fixture left: a thread to continue, or nothing.
 * @param input - The turns.
 * @param id - The case's id.
 * @returns The evidence and the tool calls.
 */
export async function actDashboard(
  world: EvalWorld,
  given: Given,
  input: ThreadInput,
  id: string,
): Promise<Acted<Outcome>> {
  const started = Date.now();
  const threadId = given.threadId ?? world.services.threads.create(evalsActor).id;
  const seen = messagesOf(world, threadId).length;
  let turns = 0;
  let error: string | undefined;
  try {
    turns = await talk(world, threadId, input);
  } catch (failure) {
    error = failure instanceof Error ? failure.message : String(failure);
  }
  const spec = lastSpec(world, threadId);
  const messages = messagesOf(world, threadId).slice(seen);
  const evidence: Outcome = {
    id,
    built: world.services.threads.get(threadId).state === 'ready' && spec !== undefined,
    ...(await builtOf(world, spec, askedOf(messages))),
    turns,
    durationMs: Date.now() - started,
    ...tally(messages),
    ...(error === undefined ? {} : { error }),
  };
  return { evidence, toolCalls: toolTrace(messages) };
}
