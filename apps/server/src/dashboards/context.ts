/** The dashboards service's dependencies and the helpers its operations share. */
import {
  type DashboardDetail,
  type DashboardSpec,
  dashboardSpecSchema,
  hasRole,
  type Role,
} from '@quanthea/shared';
import type { AuditRepository } from '../db/audit-repository.ts';
import type { DashboardRepository, VersionRow } from '../db/dashboard-repository.ts';
import { AppError } from '../lib/errors.ts';
import type { ConnectorLookup } from './check-queries.ts';
import type { SpecIssue } from './issues.ts';
import type { RunChoices, RunnerDependencies } from './run-panel.ts';
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

/** The service's dependencies with the clock resolved. */
export type ServiceContext = DashboardsDependencies & { readonly now: () => number };

/**
 * Refuses a spec with its issues.
 *
 * @param message - What went wrong.
 * @param issues - The issues.
 * @returns Never.
 * @throws {AppError} `bad_request`, with the issues as `{ part: 'spec', path, message }`.
 */
export function refuseSpec(message: string, issues: readonly SpecIssue[]): never {
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
export function validOrRefuse(context: ServiceContext, input: unknown): DashboardSpec {
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
export function visibleVersion(
  context: ServiceContext,
  id: string,
  version: number,
  role: Role,
): VersionRow {
  const row = context.repository.getVersion(id, version);
  const pinned = context.repository.get(id)?.pinnedVersionId != null;
  if (!row || !canSee(row, role, pinned))
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
export function specOf(context: ServiceContext, target: RunTarget, role: Role): DashboardSpec {
  return dashboardSpecSchema.parse(
    visibleVersion(context, target.dashboardId, target.version, role).spec,
  );
}

/**
 * Reads a dashboard.
 *
 * @param context - The service context.
 * @param id - The dashboard id.
 * @param role - The role of the request.
 * @returns The dashboard.
 * @throws {AppError} `not_found`, also for an unpinned dashboard a viewer may not see.
 */
export function get(context: ServiceContext, id: string, role: Role): DashboardDetail {
  const row = context.repository.get(id);
  // Viewers see pinned dashboards only; an unpinned one is as good as gone to them.
  if (!row || (row.pinnedVersionId === null && !hasRole(role, 'editor')))
    throw new AppError('not_found', `No dashboard ${id}.`);
  return toDetail(row, context.repository.listVersions(id), role);
}
