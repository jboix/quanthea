/**
 * The dashboards service: creates dashboards from specs, reads them by role, pins versions, and
 * runs saved panels. Dashboards have no owner; roles are the only permission.
 */
import {
  type DashboardDetail,
  type DashboardSpec,
  type DashboardVersion,
  dashboardSpecSchema,
  type PanelRun,
  type Role,
} from '@querent/shared';
import { AppError } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import {
  type DashboardsDependencies,
  get,
  type RunTarget,
  refuseSpec,
  type ServiceContext,
  specOf,
  validOrRefuse,
  visibleVersion,
} from './context.ts';
import { listVariableOptions, runPanel } from './run-panel.ts';
import { type ValidationResult, validateSpec } from './validate.ts';
import { addVersion, failuresOf, type PanelTest, restoreVersion, testRunSpec } from './versions.ts';

export type { DashboardsDependencies, RunTarget } from './context.ts';
export type { PanelTest } from './versions.ts';

/** The dashboards service. */
export interface Dashboards {
  /**
   * Creates a dashboard from a spec, as its first draft version.
   *
   * @param spec - The spec, as JSON.
   * @param changeSummary - What this version is, if given.
   * @param actor - Who creates it.
   * @returns The dashboard.
   * @throws {AppError} `bad_request` with the spec's issues.
   */
  create(spec: unknown, changeSummary: string | undefined, actor: string): DashboardDetail;
  /**
   * Reads a dashboard.
   *
   * @param id - The dashboard id.
   * @param role - The role of the request.
   * @returns The dashboard, with the versions the role may see.
   * @throws {AppError} `not_found`.
   */
  get(id: string, role: Role): DashboardDetail;
  /**
   * Reads one version.
   *
   * @param id - The dashboard id.
   * @param version - The version number.
   * @param role - The role of the request. Viewers see pinned versions only.
   * @returns The version with its spec.
   * @throws {AppError} `not_found`, also for a draft a viewer may not see.
   */
  getVersion(id: string, version: number, role: Role): DashboardVersion;
  /**
   * Pins a version, after validating it again and test-running every panel.
   *
   * @param id - The dashboard id.
   * @param version - The version number.
   * @param actor - Who pins it.
   * @returns The dashboard.
   * @throws {AppError} `bad_request` when it is pinned already, invalid, or a panel fails.
   */
  pin(id: string, version: number, actor: string): Promise<DashboardDetail>;
  /**
   * Runs one panel of a saved version.
   *
   * @param target - The version, the panel and the viewer's choices.
   * @param panelId - The panel.
   * @param role - The role of the request.
   * @param signal - Aborted when the caller gives up.
   * @returns The frames or failure of each query, and the markers.
   */
  runPanel(target: RunTarget, panelId: string, role: Role, signal?: AbortSignal): Promise<PanelRun>;
  /**
   * Lists the options of a query-backed variable.
   *
   * @param target - The version and the viewer's choices.
   * @param name - The variable.
   * @param role - The role of the request.
   * @param signal - Aborted when the caller gives up.
   * @returns The options.
   */
  variableOptions(
    target: RunTarget,
    name: string,
    role: Role,
    signal?: AbortSignal,
  ): Promise<string[]>;
  /**
   * Validates a spec against the current connectors, without saving it.
   *
   * @param spec - The spec, as JSON.
   * @returns The spec with its grid repaired, or the issues.
   */
  check(spec: unknown): ValidationResult;
  /**
   * Test-runs every panel of a spec with its defaults.
   *
   * @param spec - A valid spec.
   * @returns One run per panel.
   */
  testRun(spec: DashboardSpec): Promise<PanelTest[]>;
  /**
   * Adds a version to a dashboard.
   *
   * @param id - The dashboard id.
   * @param spec - The spec, as JSON.
   * @param changeSummary - What changed.
   * @param actor - Who made the change.
   * @returns The new version number.
   */
  addVersion(id: string, spec: unknown, changeSummary: string, actor: string): number;
  /**
   * Restores an older version as a new one.
   *
   * @param id - The dashboard id.
   * @param from - The version to restore.
   * @param actor - Who restores it.
   * @returns The new version number.
   */
  restore(id: string, from: number, actor: string): number;
}

/**
 * The rows of a new dashboard and its first version.
 *
 * @param spec - The valid spec.
 * @param changeSummary - What this version is.
 * @param actor - Who creates it.
 * @param at - When.
 * @returns The dashboard and version rows.
 */
function newRows(
  spec: DashboardSpec,
  changeSummary: string | undefined,
  actor: string,
  at: number,
) {
  const id = newId();
  const dashboard = {
    id,
    title: spec.title,
    description: spec.description ?? null,
    tags: [],
    parentDashboardId: null,
    parentVersion: null,
    pinnedVersionId: null,
    deletedAt: null,
    createdAt: at,
    updatedAt: at,
  };
  const version = {
    id: newId(),
    dashboardId: id,
    version: 1,
    spec,
    changeSummary: changeSummary ?? null,
    pinnedAt: null,
    actor,
    createdAt: at,
  };
  return { dashboard, version };
}

/**
 * Creates a dashboard.
 *
 * @param context - The service context.
 * @param input - The spec, as JSON.
 * @param changeSummary - What this version is.
 * @param actor - Who creates it.
 * @returns The dashboard.
 */
function create(
  context: ServiceContext,
  input: unknown,
  changeSummary: string | undefined,
  actor: string,
): DashboardDetail {
  const spec = validOrRefuse(context, input);
  const { dashboard, version } = newRows(spec, changeSummary, actor, context.now());
  context.repository.create(dashboard, version);
  const detail = { title: spec.title };
  context.audit.append({ actor, action: 'dashboard.create', target: dashboard.id, detail });
  return get(context, dashboard.id, 'editor');
}

/**
 * Pins a version.
 *
 * @param context - The service context.
 * @param id - The dashboard id.
 * @param version - The version number.
 * @param actor - Who pins it.
 * @returns The dashboard.
 */
async function pin(context: ServiceContext, id: string, version: number, actor: string) {
  const row = visibleVersion(context, id, version, 'editor');
  if (row.pinnedAt !== null)
    throw new AppError('bad_request', `Version ${version} is pinned already.`);
  const spec = validOrRefuse(context, row.spec);
  const failures = failuresOf(spec, await testRunSpec(context, spec));
  if (failures.length > 0) refuseSpec('Some panels fail. Fix them before pinning.', failures);
  const change = {
    versionId: row.id,
    at: context.now(),
    title: spec.title,
    description: spec.description ?? null,
    tags: [],
  };
  if (!context.repository.pin(id, change))
    throw new AppError('bad_request', `Version ${version} is pinned already.`);
  context.audit.append({ actor, action: 'dashboard.pin', target: id, detail: { version } });
  return get(context, id, 'editor');
}

/**
 * Creates the service.
 *
 * @param dependencies - The repository, audit log, connectors and executor.
 * @returns The service.
 */
export function createDashboards(dependencies: DashboardsDependencies): Dashboards {
  const context: ServiceContext = { ...dependencies, now: dependencies.now ?? Date.now };
  return {
    create: (spec, changeSummary, actor) => create(context, spec, changeSummary, actor),
    get: (id, role) => get(context, id, role),
    getVersion: (id, version, role) => {
      const row = visibleVersion(context, id, version, role);
      return { ...row, spec: dashboardSpecSchema.parse(row.spec) };
    },
    pin: (id, version, actor) => pin(context, id, version, actor),
    runPanel: (target, panelId, role, signal) =>
      runPanel(context, specOf(context, target, role), panelId, target, signal),
    variableOptions: (target, name, role, signal) =>
      listVariableOptions(context, specOf(context, target, role), name, target, signal),
    check: (spec) => validateSpec(spec, { lookup: context.lookup, now: context.now() }),
    testRun: (spec) => testRunSpec(context, spec),
    addVersion: (id, spec, changeSummary, actor) =>
      addVersion(context, id, spec, changeSummary, actor),
    restore: (id, from, actor) => restoreVersion(context, id, from, actor),
  };
}
