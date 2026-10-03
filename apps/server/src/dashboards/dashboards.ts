/**
 * The dashboards service: creates dashboards from specs, reads them by role, pins versions, and
 * runs saved panels. Dashboards have no owner; roles are the only permission.
 */
import {
  type DashboardDetail,
  type DashboardSpec,
  type DashboardVersion,
  dashboardSpecSchema,
  type LibrarySearch,
  type PanelRun,
  type Role,
} from '@quanthea/shared';
import { AppError } from '../lib/errors.ts';
import type { Variables } from '../query/variables.ts';
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
import { type LibraryQuery, searchLibrary } from './library.ts';
import { copyPinned, copyVersion, findPinned, type PinnedMatch } from './pinned.ts';
import { newRows } from './rows.ts';
import { bindChoices, listVariableOptions, type RunChoices, runPanel } from './run-panel.ts';
import { type ValidationResult, validateSpec } from './validate.ts';
import { addVersion, failuresOf, type PanelTest, restoreVersion, testRunSpec } from './versions.ts';

export type { DashboardsDependencies, RunTarget } from './context.ts';
export type { PanelTest } from './versions.ts';

/**
 * Writes a pinned dashboard's description and tags, best effort: `null` when it could not. The
 * bootstrap hands it the metadata model; the service never imports the agent.
 */
export type DescribeForPin = (
  spec: DashboardSpec,
) => Promise<{ readonly description: string; readonly tags: readonly string[] } | null>;

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
   * Makes a version the one shown, after validating it again and test-running every panel. Any
   * version can be pinned, including one pinned before.
   *
   * @param id - The dashboard id.
   * @param version - The version number.
   * @param actor - Who pins it.
   * @param describe - Writes the description and tags, once the version passes its checks.
   * @returns The dashboard.
   * @throws {AppError} `bad_request` when it is the one shown already, invalid, or a panel fails.
   */
  pin(
    id: string,
    version: number,
    actor: string,
    describe?: DescribeForPin,
  ): Promise<DashboardDetail>;
  /**
   * Stops showing any version: the dashboard leaves the library and viewers can no longer open it.
   *
   * @param id - The dashboard id.
   * @param actor - Who unpins it.
   * @returns The dashboard.
   * @throws {AppError} `bad_request` when it is not pinned.
   */
  unpin(id: string, actor: string): DashboardDetail;
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
   * Binds a viewer's variable choices for a spec, as a panel run binds them, so queries run for
   * the same choices see the same values. The values stay bound, never pasted into a query.
   *
   * @param spec - The spec.
   * @param choices - The viewer's variables and time range.
   * @param signal - Aborted when the caller gives up.
   * @returns The bindings by variable name.
   */
  bindVariables(spec: DashboardSpec, choices: RunChoices, signal?: AbortSignal): Promise<Variables>;
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
  /**
   * Finds pinned dashboards that may already answer a question, with no model.
   *
   * @param question - The question.
   * @returns At most three matches, the best first.
   */
  findPinned(question: string): PinnedMatch[];
  /**
   * Copies a pinned dashboard into a new one that records where it came from.
   *
   * @param id - The pinned dashboard.
   * @param actor - Who copies it.
   * @returns The new dashboard, its first version and its title.
   * @throws {AppError} `not_found` when the dashboard is not pinned.
   */
  copyPinned(id: string, actor: string): { dashboardId: string; version: number; title: string };
  /**
   * Copies any version into a new dashboard that records where it came from.
   *
   * @param id - The dashboard.
   * @param version - The version to copy.
   * @param actor - Who copies it.
   * @returns The new dashboard, its first version and its title.
   * @throws {AppError} `not_found` when the dashboard has no such version.
   */
  copyVersion(
    id: string,
    version: number,
    actor: string,
  ): { dashboardId: string; version: number; title: string };
  /**
   * Searches the pinned dashboards and their panels.
   *
   * @param query - The words and the filters.
   * @returns The matching dashboards, and every tag and connector for the filters.
   */
  searchLibrary(query: LibraryQuery): LibrarySearch;
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
 * Pins a version: from now on, the library, the dashboard's link and viewers show it. Any
 * version can be pinned, including one pinned before, after its panels run again.
 *
 * @param context - The service context.
 * @param id - The dashboard id.
 * @param version - The version number.
 * @param actor - Who pins it.
 * @param describe - Writes the description and tags, once the version passes its checks.
 * @returns The dashboard.
 */
async function pin(
  context: ServiceContext,
  id: string,
  version: number,
  actor: string,
  describe?: DescribeForPin,
) {
  const row = visibleVersion(context, id, version, 'editor');
  if (context.repository.get(id)?.pinnedVersionId === row.id)
    throw new AppError('bad_request', `Version ${version} is already the one shown.`);
  const spec = validOrRefuse(context, row.spec);
  const failures = failuresOf(spec, await testRunSpec(context, spec));
  if (failures.length > 0) refuseSpec('Some panels fail. Fix them before pinning.', failures);
  // The spec's own title and description win; the model fills what the spec leaves out.
  const described = describe ? await describe(spec) : null;
  const change = {
    versionId: row.id,
    at: context.now(),
    title: spec.title,
    description: spec.description ?? described?.description ?? null,
    tags: described?.tags ?? [],
  };
  if (!context.repository.pin(id, change))
    throw new AppError('not_found', `Dashboard ${id} has no version ${version}.`);
  context.audit.append({ actor, action: 'dashboard.pin', target: id, detail: { version } });
  return get(context, id, 'editor');
}

/**
 * Stops showing any version: the dashboard leaves the library and viewers can no longer open it.
 *
 * @param context - The service context.
 * @param id - The dashboard id.
 * @param actor - Who unpins it.
 * @returns The dashboard.
 * @throws {AppError} `not_found` when it does not exist, `bad_request` when it is not pinned.
 */
function unpin(context: ServiceContext, id: string, actor: string): DashboardDetail {
  get(context, id, 'editor');
  if (!context.repository.unpin(id, context.now()))
    throw new AppError('bad_request', 'The dashboard is not pinned.');
  context.audit.append({ actor, action: 'dashboard.unpin', target: id });
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
    pin: (id, version, actor, describe) => pin(context, id, version, actor, describe),
    unpin: (id, actor) => unpin(context, id, actor),
    runPanel: (target, panelId, role, signal) =>
      runPanel(context, specOf(context, target, role), panelId, target, signal),
    variableOptions: (target, name, role, signal) =>
      listVariableOptions(context, specOf(context, target, role), name, target, signal),
    bindVariables: (spec, choices, signal) => bindChoices(context, spec, choices, signal),
    check: (spec) => validateSpec(spec, { lookup: context.lookup, now: context.now() }),
    testRun: (spec) => testRunSpec(context, spec),
    addVersion: (id, spec, changeSummary, actor) =>
      addVersion(context, id, spec, changeSummary, actor),
    restore: (id, from, actor) => restoreVersion(context, id, from, actor),
    findPinned: (question) => findPinned(context, question),
    copyPinned: (id, actor) => copyPinned(context, id, actor),
    copyVersion: (id, version, actor) => copyVersion(context, id, version, actor),
    searchLibrary: (query) => searchLibrary(context, query),
  };
}
