/**
 * The bin of threads: moving a thread in and out, listing it, and purging it with its dashboard.
 * The other thread reads (`thread-repository.ts`) skip binned threads. Purging a thread never
 * deletes an alert or a report it made: it keeps its versions, and its `thread_id` becomes `NULL`.
 */
import type { Database } from 'bun:sqlite';

/** A thread in the bin. */
export interface BinnedRow {
  /** The thread. */
  readonly id: string;
  /** Its title. */
  readonly title: string | null;
  /** Its dashboard, if it has one. */
  readonly dashboardId: string | null;
  /** The dashboard's title. */
  readonly dashboardTitle: string | null;
  /** When it went to the bin. */
  readonly deletedAt: number;
  /** Who moved it there. */
  readonly deletedBy: string | null;
  /** Who owns it. */
  readonly ownerId: string | null;
}

/** The thread a dashboard belongs to. */
export interface ThreadOwner {
  /** The thread. */
  readonly threadId: string;
  /** Whether it is in the bin. */
  readonly binned: boolean;
  /** Who owns it. */
  readonly ownerId: string | null;
}

/** What moving a thread to the bin did. */
export type BinOutcome = 'binned' | 'missing' | 'pinned' | 'alert_active' | 'report_active';

/** What purging a binned thread did. */
export type PurgeOutcome = 'purged' | 'missing' | 'alert_active' | 'report_active';

/** Stores the bin. */
export interface ThreadBinRepository {
  /**
   * Moves a thread to the bin, unless its dashboard is pinned or its alert or report is active.
   *
   * @param id - The thread.
   * @param at - When.
   * @param actor - Who.
   * @returns `binned`; `missing` when there is no such thread outside the bin; `pinned` when its
   *   dashboard is pinned; `alert_active` when an alert it made has an active version and is not
   *   deactivated; `report_active` when a report it made is.
   */
  bin(id: string, at: number, actor: string): BinOutcome;
  /**
   * Moves every draft of an owner to the bin, in one transaction: their threads outside the bin
   * whose dashboard is not pinned and whose alert or report is not active.
   *
   * @param ownerId - Whose drafts.
   * @param at - When.
   * @param actor - Who.
   * @returns The ids of the threads binned.
   */
  binDrafts(ownerId: string, at: number, actor: string): string[];
  /**
   * Takes a thread out of the bin.
   *
   * @param id - The thread.
   * @param at - When, as its last change.
   * @returns `false` when it is not in the bin.
   */
  restore(id: string, at: number): boolean;
  /**
   * Lists the threads in the bin, the most recently binned first.
   *
   * @returns The threads.
   */
  list(): BinnedRow[];
  /**
   * Lists the threads binned before a time that may be purged: those whose alert or report is not
   * active.
   *
   * @param before - The time.
   * @returns Their ids.
   */
  binnedBefore(before: number): string[];
  /**
   * Deletes a binned thread with its messages and plans, and its dashboard with every version,
   * in one transaction. A pinned dashboard, or one another thread uses, stays. A thread whose
   * alert or report is active stays too: a database of an earlier release may hold one.
   *
   * @param id - The thread.
   * @returns `purged`; `missing` when it is not in the bin; `alert_active` or `report_active`
   *   when an alert or a report it made is active.
   */
  purge(id: string): PurgeOutcome;
  /**
   * The thread a dashboard belongs to, in the bin or not.
   *
   * @param dashboardId - The dashboard.
   * @returns The thread and whether it is binned, or `undefined`.
   */
  ownerOf(dashboardId: string): ThreadOwner | undefined;
}

/** A binned thread as SQLite returns it. */
interface StoredBinned {
  /** The thread. */
  id: string;
  /** The title. */
  title: string | null;
  /** The dashboard. */
  dashboard_id: string | null;
  /** The dashboard's title. */
  dashboard_title: string | null;
  /** When it was binned. */
  deleted_at: number;
  /** Who binned it. */
  deleted_by: string | null;
  /** Who owns it. */
  created_by: string | null;
}

/** Whether an alert the thread `t` made has an active version and is not deactivated. */
const alertActive = `EXISTS (SELECT 1 FROM alerts a WHERE a.thread_id = t.id
  AND a.active_version IS NOT NULL AND a.deactivated_at IS NULL)`;

/** Whether a report the thread `t` made has an active version and is not deactivated. */
const reportActive = `EXISTS (SELECT 1 FROM reports r WHERE r.thread_id = t.id
  AND r.active_version IS NOT NULL AND r.deactivated_at IS NULL)`;

/**
 * Prepares the statements of the bin.
 *
 * @param database - A database the migrations have run on.
 * @returns The statements.
 */
function binStatements(database: Database) {
  return {
    live: database.query<{ pinned: number; alert_active: number; report_active: number }, [string]>(
      `SELECT d.pinned_version_id IS NOT NULL AS pinned, ${alertActive} AS alert_active,
       ${reportActive} AS report_active
       FROM threads t LEFT JOIN dashboards d ON d.id = t.dashboard_id
       WHERE t.id = ? AND t.deleted_at IS NULL`,
    ),
    bin: database.query('UPDATE threads SET deleted_at = ?, deleted_by = ? WHERE id = ?'),

    restore: database.query(
      `UPDATE threads SET deleted_at = NULL, deleted_by = NULL, updated_at = ?
       WHERE id = ? AND deleted_at IS NOT NULL`,
    ),
    list: database.query<StoredBinned, []>(
      `SELECT t.id, t.title, t.dashboard_id, d.title AS dashboard_title, t.deleted_at, t.deleted_by,
         t.created_by
       FROM threads t LEFT JOIN dashboards d ON d.id = t.dashboard_id
       WHERE t.deleted_at IS NOT NULL ORDER BY t.deleted_at DESC, t.id DESC`,
    ),
    before: database.query<{ id: string }, [number]>(
      `SELECT t.id FROM threads t WHERE t.deleted_at IS NOT NULL AND t.deleted_at < ?
       AND NOT ${alertActive} AND NOT ${reportActive}`,
    ),
    owner: database.query<{ id: string; binned: number; created_by: string | null }, [string]>(
      `SELECT id, deleted_at IS NOT NULL AS binned, created_by FROM threads WHERE dashboard_id = ?
       ORDER BY deleted_at IS NOT NULL, created_at LIMIT 1`,
    ),
  };
}

/**
 * Builds the transaction that moves a thread to the bin, after checking its dashboard.
 *
 * @param database - A database the migrations have run on.
 * @param statements - The prepared statements.
 * @returns The bin method.
 */
function binner(
  database: Database,
  statements: ReturnType<typeof binStatements>,
): ThreadBinRepository['bin'] {
  return database.transaction((id: string, at: number, actor: string): BinOutcome => {
    const live = statements.live.get(id);
    if (!live) return 'missing';
    if (live.pinned) return 'pinned';
    if (live.alert_active) return 'alert_active';
    if (live.report_active) return 'report_active';
    statements.bin.run(at, actor, id);
    return 'binned';
  });
}

/**
 * Builds the transaction that moves an owner's drafts to the bin.
 *
 * @param database - A database the migrations have run on.
 * @param statements - The prepared statements.
 * @returns The method.
 */
function draftBinner(
  database: Database,
  statements: ReturnType<typeof binStatements>,
): ThreadBinRepository['binDrafts'] {
  const drafts = database.query<{ id: string }, [string]>(
    `SELECT t.id FROM threads t LEFT JOIN dashboards d ON d.id = t.dashboard_id
     WHERE t.created_by = ? AND t.deleted_at IS NULL AND d.pinned_version_id IS NULL
     AND NOT ${alertActive} AND NOT ${reportActive}`,
  );
  return database.transaction((ownerId: string, at: number, actor: string): string[] => {
    const ids = drafts.all(ownerId).map((row) => row.id);
    for (const id of ids) statements.bin.run(at, actor, id);
    return ids;
  });
}

/**
 * Prepares the statements of a purge.
 *
 * @param database - A database the migrations have run on.
 * @returns The statements.
 */
function purgeStatements(database: Database) {
  return {
    binnedDashboard: database.query<
      { dashboard_id: string | null; alert_active: number; report_active: number },
      [string]
    >(
      `SELECT t.dashboard_id, ${alertActive} AS alert_active, ${reportActive} AS report_active
       FROM threads t WHERE t.id = ? AND t.deleted_at IS NOT NULL`,
    ),
    removeThread: database.query('DELETE FROM threads WHERE id = ?'),
    removeDashboard: database.query(
      `DELETE FROM dashboards WHERE id = ?1 AND pinned_version_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM threads WHERE dashboard_id = ?1)`,
    ),
  };
}

/**
 * Builds the transaction that purges a binned thread and its dashboard.
 *
 * @param database - A database the migrations have run on.
 * @returns The purge method.
 */
function purger(database: Database): ThreadBinRepository['purge'] {
  const statements = purgeStatements(database);
  return database.transaction((id: string): PurgeOutcome => {
    const binned = statements.binnedDashboard.get(id);
    if (!binned) return 'missing';
    if (binned.alert_active) return 'alert_active';
    if (binned.report_active) return 'report_active';
    // The thread goes first, so the dashboard is no longer in use when it is checked.
    statements.removeThread.run(id);
    if (binned.dashboard_id !== null) statements.removeDashboard.run(binned.dashboard_id);
    return 'purged';
  });
}

/**
 * Creates the bin's repository over an open database.
 *
 * @param database - A database the migrations have run on.
 * @returns The repository.
 */
export function createThreadBinRepository(database: Database): ThreadBinRepository {
  const statements = binStatements(database);
  return {
    bin: binner(database, statements),
    binDrafts: draftBinner(database, statements),
    restore: (id, at) => statements.restore.run(at, id).changes > 0,
    list: () =>
      statements.list.all().map((row) => ({
        id: row.id,
        title: row.title,
        dashboardId: row.dashboard_id,
        dashboardTitle: row.dashboard_title,
        deletedAt: row.deleted_at,
        deletedBy: row.deleted_by,
        ownerId: row.created_by,
      })),
    binnedBefore: (before) => statements.before.all(before).map((row) => row.id),
    purge: purger(database),
    ownerOf: (dashboardId) => {
      const row = statements.owner.get(dashboardId);
      return row
        ? { threadId: row.id, binned: row.binned === 1, ownerId: row.created_by }
        : undefined;
    },
  };
}
