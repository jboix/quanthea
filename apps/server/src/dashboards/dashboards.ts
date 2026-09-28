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
import type { AuditRepository } from '../db/audit-repository.ts';
import type { DashboardRepository, VersionRow } from '../db/dashboard-repository.ts';
import { AppError } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import type { ConnectorLookup } from './check-queries.ts';
import type { SpecIssue } from './issues.ts';
import {
  listVariableOptions,
  type RunChoices,
  type RunnerDependencies,
  runPanel,
} from './run-panel.ts';
import { validateSpec } from './validate.ts';
import { canSee, toDetail } from './views.ts';

/** What the service needs. */
export interface DashboardsDependencies extends Omit<RunnerDependencies, 'now'> {
  /** Stores dashboards. */
  readonly repository: DashboardRepository;
  /** Records who did what. */
  readonly audit: AuditRepository;
  /** Finds a connector by name, for validation. */
  readonly lookup: ConnectorLookup;
  /** The clock; `Date.now` by default. */
  readonly now?: () => number;
}

/** What names a saved version to run. */
export interface RunTarget extends RunChoices {
  /** The dashboard. */
  readonly dashboardId: string;
  /** The version. */
  readonly version: number;
}

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
}

/** The service's dependencies with the clock resolved. */
type ServiceContext = DashboardsDependencies & { readonly now: () => number };

/**
 * Refuses a spec with its issues.
 *
 * @param message - What went wrong.
 * @param issues - The issues.
 * @returns Never.
 * @throws {AppError} `bad_request`, with the issues as `{ part: 'spec', path, message }`.
 */
function refuseSpec(message: string, issues: readonly SpecIssue[]): never {
  throw new AppError(
    'bad_request',
    message,
    issues.map((issue) => ({ part: 'spec', ...issue })),
  );
}

/**
 * Validates a spec against the current connectors.
 *
 * @param context - The service context.
 * @param input - The spec, as JSON.
 * @returns The valid spec.
 * @throws {AppError} `bad_request` with the issues.
 */
function validOrRefuse(context: ServiceContext, input: unknown): DashboardSpec {
  const result = validateSpec(input, { lookup: context.lookup, now: context.now() });
  if (!result.ok) refuseSpec('The spec is invalid.', result.issues);
  return result.spec;
}

/**
 * Finds a version the role may see.
 *
 * @param context - The service context.
 * @param id - The dashboard id.
 * @param version - The version number.
 * @param role - The role of the request.
 * @returns The version.
 * @throws {AppError} `not_found`.
 */
function visibleVersion(
  context: ServiceContext,
  id: string,
  version: number,
  role: Role,
): VersionRow {
  const row = context.repository.getVersion(id, version);
  if (!row || !canSee(row, role))
    throw new AppError('not_found', `Dashboard ${id} has no version ${version}.`);
  return row;
}

/**
 * The spec of a version the role may see.
 *
 * @param context - The service context.
 * @param target - The dashboard and version.
 * @param role - The role of the request.
 * @returns The spec, parsed.
 */
function specOf(context: ServiceContext, target: RunTarget, role: Role): DashboardSpec {
  return dashboardSpecSchema.parse(
    visibleVersion(context, target.dashboardId, target.version, role).spec,
  );
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
 * Reads a dashboard.
 *
 * @param context - The service context.
 * @param id - The dashboard id.
 * @param role - The role of the request.
 * @returns The dashboard.
 */
function get(context: ServiceContext, id: string, role: Role): DashboardDetail {
  const row = context.repository.get(id);
  if (!row) throw new AppError('not_found', `No dashboard ${id}.`);
  return toDetail(row, context.repository.listVersions(id), role);
}

/**
 * Test-runs every panel of a spec with its defaults.
 *
 * @param context - The service context.
 * @param spec - The spec.
 * @returns An issue for each failing query.
 */
async function testRun(context: ServiceContext, spec: DashboardSpec): Promise<SpecIssue[]> {
  const runs = await Promise.all(
    spec.panels.map((panel) => runPanel(context, spec, panel.id, { variables: {} })),
  );
  return runs.flatMap((run, panelIndex) =>
    run.queries.flatMap((outcome, queryIndex) =>
      outcome.error
        ? [{ path: `panels[${panelIndex}].queries[${queryIndex}]`, message: outcome.error.message }]
        : [],
    ),
  );
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
  const failures = await testRun(context, spec);
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
  };
}
