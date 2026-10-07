/**
 * Conditions on the threads of dashboards, alerts and reports. A dashboard, alert or report whose
 * thread is in the bin is never pinned or activated: purging the thread would leave it without
 * its thread.
 */
import type { Database } from 'bun:sqlite';

/** A table whose rows a thread makes. */
type MadeByThread = 'alerts' | 'reports';

/** A store of alerts or reports, which threads make. */
export interface MadeByThreadStore {
  /**
   * Whether the thread that made a row is in the bin.
   *
   * @param id - The alert or report.
   * @returns `true` while it is.
   */
  threadBinned(id: string): boolean;
}

/**
 * What activating a version did: `activated`; `binned` when the thread that made the alert or
 * report is in the bin; `missing` when it or the version does not exist.
 */
export type ActivateOutcome = 'activated' | 'missing' | 'binned';

/**
 * The SQL condition that the thread that made a row is not in the bin. A row without a thread
 * meets it.
 *
 * @param table - The table of the row, as named in the statement.
 * @returns The condition.
 */
export function threadOutsideBin(table: MadeByThread): string {
  return `NOT EXISTS (SELECT 1 FROM threads WHERE threads.id = ${table}.thread_id
    AND threads.deleted_at IS NOT NULL)`;
}

/**
 * Prepares the check that the thread that made a row is in the bin.
 *
 * @param database - A database the migrations have run on.
 * @param table - The table of the rows.
 * @returns The check: whether the row exists and its thread is in the bin.
 */
export function threadBinnedCheck(database: Database, table: MadeByThread) {
  const query = database.query<{ binned: number }, [string]>(
    `SELECT NOT ${threadOutsideBin(table)} AS binned FROM ${table} WHERE id = ?`,
  );
  return (id: string): boolean => query.get(id)?.binned === 1;
}

/**
 * The condition that a dashboard has threads and all of them are in the bin.
 *
 * @param dashboardId - The SQL parameter that holds the dashboard id, such as `?1`.
 * @returns The SQL condition.
 */
export function dashboardThreadsBinned(dashboardId: string): string {
  return `EXISTS (SELECT 1 FROM threads WHERE dashboard_id = ${dashboardId})
    AND NOT EXISTS (SELECT 1 FROM threads WHERE dashboard_id = ${dashboardId}
      AND deleted_at IS NULL)`;
}

/**
 * Prepares the check that a dashboard has threads and all of them are in the bin.
 *
 * @param database - A database the migrations have run on.
 * @returns The check.
 */
export function dashboardThreadsBinnedCheck(database: Database) {
  const query = database.query<{ binned: number }, [string]>(
    `SELECT ${dashboardThreadsBinned('?1')} AS binned`,
  );
  return (dashboardId: string): boolean => query.get(dashboardId)?.binned === 1;
}
