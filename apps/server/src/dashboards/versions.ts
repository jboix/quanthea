/**
 * New versions of a dashboard: the agent's writes and Undo. A version is never rewritten; Undo
 * restores an older spec as a new version.
 */
import type { DashboardSpec, PanelRun } from '@quanthea/shared';
import { newId } from '../lib/ids.ts';
import { type ServiceContext, validOrRefuse, visibleVersion } from './context.ts';
import type { SpecIssue } from './issues.ts';
import { runPanel } from './run-panel.ts';

/** One panel's test run. */
export interface PanelTest {
  /** The panel id. */
  readonly panelId: string;
  /** The run with the default variables. */
  readonly run: PanelRun;
}

/**
 * Test-runs every panel of a spec with its default variables and time range.
 *
 * @param context - The service context.
 * @param spec - The spec.
 * @returns One run per panel, in panel order.
 */
export async function testRunSpec(
  context: ServiceContext,
  spec: DashboardSpec,
): Promise<PanelTest[]> {
  return Promise.all(
    spec.panels.map(async (panel) => ({
      panelId: panel.id,
      run: await runPanel(context, spec, panel.id, { variables: {} }),
    })),
  );
}

/**
 * The failing queries of a test run, as spec issues.
 *
 * @param spec - The spec.
 * @param tests - Its test run.
 * @returns An issue for each failing query, at `panels[i].queries[j]`.
 */
export function failuresOf(spec: DashboardSpec, tests: readonly PanelTest[]): SpecIssue[] {
  return tests.flatMap((test) => {
    const panelIndex = spec.panels.findIndex((panel) => panel.id === test.panelId);
    return test.run.queries.flatMap((outcome, queryIndex) =>
      outcome.error
        ? [{ path: `panels[${panelIndex}].queries[${queryIndex}]`, message: outcome.error.message }]
        : [],
    );
  });
}

/**
 * Adds a version to a dashboard.
 *
 * @param context - The service context.
 * @param id - The dashboard id.
 * @param input - The spec, as JSON.
 * @param changeSummary - What changed, in one line.
 * @param actor - Who made the change.
 * @returns The new version number.
 * @throws {AppError} `not_found` for an unknown dashboard, `bad_request` with the spec's issues.
 */
export function addVersion(
  context: ServiceContext,
  id: string,
  input: unknown,
  changeSummary: string,
  actor: string,
): number {
  visibleVersion(context, id, 1, 'editor');
  const spec = validOrRefuse(context, input);
  const version = {
    id: newId(),
    dashboardId: id,
    spec,
    changeSummary,
    pinnedAt: null,
    actor,
    createdAt: context.now(),
  };
  const number = context.repository.addVersion(version);
  context.audit.append({
    actor,
    action: 'dashboard.version',
    target: id,
    detail: { version: number },
  });
  return number;
}

/**
 * Restores an older version as a new one, for Undo.
 *
 * @param context - The service context.
 * @param id - The dashboard id.
 * @param from - The version to restore.
 * @param actor - Who restores it.
 * @returns The new version number.
 */
export function restoreVersion(
  context: ServiceContext,
  id: string,
  from: number,
  actor: string,
): number {
  const older = visibleVersion(context, id, from, 'editor');
  return addVersion(context, id, older.spec, `restored v${from}`, actor);
}
