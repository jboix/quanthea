/**
 * The layouts of dashboards: how the version shown is arranged, saved as revisions with a history.
 * A layout never changes the version; only the version shown takes a new layout, and a change
 * based on a revision that is no longer the latest is refused, so two people never overwrite each
 * other unseen.
 */
import {
  type DashboardLayout,
  type DashboardSpec,
  dashboardLayoutSchema,
  dashboardSpecSchema,
  layoutProblems,
  packLayout,
} from '@quanthea/shared';
import type { AuditRepository } from '../db/audit-repository.ts';
import type { DashboardRepository } from '../db/dashboard-repository.ts';
import type { LayoutRepository, LayoutRow } from '../db/layout-repository.ts';
import { AppError } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';

/** A revision of a version's layout, its layout parsed. */
export type LayoutEntry = Omit<LayoutRow, 'layout'> & { readonly layout: DashboardLayout };

/** The layouts service. */
export interface DashboardLayouts {
  /**
   * Lists the revisions of a version's layout.
   *
   * @param dashboardId - The dashboard.
   * @param version - The version.
   * @returns The revisions, latest first.
   * @throws {AppError} `not_found` when the dashboard has no such version.
   */
  history(dashboardId: string, version: number): LayoutEntry[];
  /**
   * Saves a layout of the version shown as a new revision, its shown panels packed.
   *
   * @param target - The dashboard and the version shown.
   * @param layout - The layout.
   * @param basedOn - The revision the change started from, or `null` for the spec's own.
   * @param actor - Who saves it.
   * @returns The revision.
   * @throws {AppError} `not_found`; `bad_request` for another version than the one shown or a
   *   layout that does not fit the spec; `conflict` when another revision was saved since.
   */
  save(
    target: LayoutTarget,
    layout: DashboardLayout,
    basedOn: number | null,
    actor: string,
  ): LayoutEntry;
  /**
   * Restores an earlier revision of the version shown, by saving a revision that copies it.
   *
   * @param target - The dashboard and the version shown.
   * @param revision - The revision to restore.
   * @param basedOn - The latest revision the person saw.
   * @param actor - Who restores it.
   * @returns The new revision.
   * @throws {AppError} as `save` does, and `not_found` for an unknown revision.
   */
  restore(
    target: LayoutTarget,
    revision: number,
    basedOn: number | null,
    actor: string,
  ): LayoutEntry;
}

/** One version of a dashboard. */
export interface LayoutTarget {
  /** The dashboard. */
  readonly dashboardId: string;
  /** The version. */
  readonly version: number;
}

/** What the service needs. */
export interface LayoutsDependencies {
  /** Stores dashboards. */
  readonly repository: DashboardRepository;
  /** Stores layouts. */
  readonly layouts: LayoutRepository;
  /** Records who did what. */
  readonly audit: AuditRepository;
  /** The clock; `Date.now` by default. */
  readonly now?: () => number;
}

/** The service's dependencies with the clock resolved. */
type Context = LayoutsDependencies & { readonly now: () => number };

/**
 * A stored revision with its layout parsed.
 *
 * @param row - The stored revision.
 * @returns The revision.
 */
function entryOf(row: LayoutRow): LayoutEntry {
  return { ...row, layout: dashboardLayoutSchema.parse(row.layout) };
}

/**
 * The spec of the version shown, refusing any other version.
 *
 * @param context - The service context.
 * @param target - The dashboard and version.
 * @returns The spec.
 * @throws {AppError} `not_found`, or `bad_request` when the version is not the one shown.
 */
function shownSpec(context: Context, target: LayoutTarget): DashboardSpec {
  const { dashboardId, version } = target;
  const row = context.repository.getVersion(dashboardId, version);
  if (!row) throw new AppError('not_found', `Dashboard ${dashboardId} has no version ${version}.`);
  if (context.repository.get(dashboardId)?.pinnedVersionId !== row.id)
    throw new AppError('bad_request', 'Only the version shown in the library can be arranged.');
  return dashboardSpecSchema.parse(row.spec);
}

/**
 * Stores a revision of the version shown.
 *
 * @param context - The service context.
 * @param target - The dashboard and version.
 * @param change - The layout, the revision it copies if any, the base revision and the actor.
 * @returns The revision.
 */
function store(
  context: Context,
  target: LayoutTarget,
  change: {
    readonly layout: DashboardLayout;
    readonly restoredFrom: number | null;
    readonly basedOn: number | null;
    readonly actor: string;
  },
): LayoutEntry {
  const problems = layoutProblems(shownSpec(context, target), change.layout);
  if (problems.length > 0)
    throw new AppError('bad_request', 'The layout does not fit the dashboard.', problems);
  const { restoredFrom, actor } = change;
  const layout = packLayout(change.layout);
  const row = { id: newId(), ...target, layout, restoredFrom, actor, createdAt: context.now() };
  const stored = context.layouts.add(row, change.basedOn);
  if (!stored) throw new AppError('conflict', 'Someone else changed the layout. Reload it first.');
  const detail = { version: target.version, revision: stored.revision, restoredFrom };
  context.audit.append({ actor, action: 'dashboard.layout', target: target.dashboardId, detail });
  return entryOf(stored);
}

/**
 * Creates the service.
 *
 * @param dependencies - The repositories, the audit log and the clock.
 * @returns The service.
 */
export function createDashboardLayouts(dependencies: LayoutsDependencies): DashboardLayouts {
  const context: Context = { ...dependencies, now: dependencies.now ?? Date.now };
  return {
    history: (dashboardId, version) => {
      if (!context.repository.getVersion(dashboardId, version))
        throw new AppError('not_found', `Dashboard ${dashboardId} has no version ${version}.`);
      return context.layouts.history(dashboardId, version).map(entryOf);
    },
    save: (target, layout, basedOn, actor) =>
      store(context, target, { layout, restoredFrom: null, basedOn, actor }),
    restore: (target, revision, basedOn, actor) => {
      const earlier = context.layouts
        .history(target.dashboardId, target.version)
        .find((row) => row.revision === revision);
      if (!earlier) throw new AppError('not_found', `The layout has no revision ${revision}.`);
      const { layout } = entryOf(earlier);
      return store(context, target, { layout, restoredFrom: revision, basedOn, actor });
    },
  };
}
