/**
 * Layouts: how the version shown of a dashboard or a report is arranged, saved as revisions with
 * a history. A layout never changes the version; only the version shown takes a new layout, and a
 * change based on a revision that is no longer the latest is refused, so two people never
 * overwrite each other unseen. What is arranged (a `LayoutSubject`) says which version is shown
 * and which panels a layout names.
 */
import {
  type Arranged,
  type DashboardLayout,
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

/** The layouts service of dashboards, or of reports. */
export interface Layouts {
  /**
   * Lists the revisions of a version's layout.
   *
   * @param subjectId - The dashboard or the report.
   * @param version - The version.
   * @returns The revisions, latest first.
   * @throws {AppError} `not_found` when it has no such version.
   */
  history(subjectId: string, version: number): LayoutEntry[];
  /**
   * Saves a layout of the version shown as a new revision, its shown panels packed.
   *
   * @param target - The dashboard or the report, and the version shown.
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
   * @param target - The dashboard or the report, and the version shown.
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

/** One version of a dashboard or a report. */
export interface LayoutTarget {
  /** The dashboard or the report. */
  readonly subjectId: string;
  /** The version. */
  readonly version: number;
}

/** What is arranged: dashboards, or reports. */
export interface LayoutSubject {
  /** The audit action a saved revision is recorded under, such as `dashboard.layout`. */
  readonly action: string;
  /**
   * Checks a version exists.
   *
   * @param target - The version.
   * @throws {AppError} `not_found`.
   */
  check(target: LayoutTarget): void;
  /**
   * The panels a layout of the version shown names, refusing any other version.
   *
   * @param target - The version.
   * @returns The panels, each with the place the spec gives it.
   * @throws {AppError} `not_found`, or `bad_request` when the version is not the one shown.
   */
  arranged(target: LayoutTarget): Arranged;
}

/** What the service needs. */
export interface LayoutsDependencies {
  /** What is arranged. */
  readonly subject: LayoutSubject;
  /** Stores its layouts. */
  readonly layouts: LayoutRepository;
  /** Records who did what. */
  readonly audit: AuditRepository;
  /** The clock; `Date.now` by default. */
  readonly now?: (() => number) | undefined;
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
 * Dashboards as what is arranged: the version shown is the one pinned, and a layout names every
 * panel of its spec.
 *
 * @param repository - Stores dashboards.
 * @returns The subject.
 */
export function dashboardSubject(repository: DashboardRepository): LayoutSubject {
  const versionOf = ({ subjectId, version }: LayoutTarget) => {
    const row = repository.getVersion(subjectId, version);
    if (!row) throw new AppError('not_found', `Dashboard ${subjectId} has no version ${version}.`);
    return row;
  };
  return {
    action: 'dashboard.layout',
    check: (target) => void versionOf(target),
    arranged: (target) => {
      const row = versionOf(target);
      if (repository.get(target.subjectId)?.pinnedVersionId !== row.id)
        throw new AppError('bad_request', 'Only the version shown in the library can be arranged.');
      return dashboardSpecSchema.parse(row.spec);
    },
  };
}

/**
 * Stores a revision of the version shown.
 *
 * @param context - The service context.
 * @param target - The dashboard or the report, and the version.
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
  const { subject } = context;
  const problems = layoutProblems(subject.arranged(target), change.layout);
  if (problems.length > 0)
    throw new AppError('bad_request', 'The layout does not fit its panels.', problems);
  const { restoredFrom, actor } = change;
  const layout = packLayout(change.layout);
  const row = { id: newId(), ...target, layout, restoredFrom, actor, createdAt: context.now() };
  const stored = context.layouts.add(row, change.basedOn);
  if (!stored) throw new AppError('conflict', 'Someone else changed the layout. Reload it first.');
  const detail = { version: target.version, revision: stored.revision, restoredFrom };
  context.audit.append({ actor, action: subject.action, target: target.subjectId, detail });
  return entryOf(stored);
}

/**
 * Creates the layouts service of dashboards, or of reports.
 *
 * @param dependencies - What is arranged, the repository of its layouts, the audit log and the
 *   clock.
 * @returns The service.
 */
export function createLayouts(dependencies: LayoutsDependencies): Layouts {
  const context: Context = { ...dependencies, now: dependencies.now ?? Date.now };
  return {
    history: (subjectId, version) => {
      context.subject.check({ subjectId, version });
      return context.layouts.history(subjectId, version).map(entryOf);
    },
    save: (target, layout, basedOn, actor) =>
      store(context, target, { layout, restoredFrom: null, basedOn, actor }),
    restore: (target, revision, basedOn, actor) => {
      const earlier = context.layouts
        .history(target.subjectId, target.version)
        .find((row) => row.revision === revision);
      if (!earlier) throw new AppError('not_found', `The layout has no revision ${revision}.`);
      const { layout } = entryOf(earlier);
      return store(context, target, { layout, restoredFrom: revision, basedOn, actor });
    },
  };
}
