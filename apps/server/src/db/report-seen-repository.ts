/**
 * The latest run each person opened of each report, so the reports list and the rail show the
 * reports with a run they have not opened. Run ids are ULIDs and sort by time, so the latest seen
 * is the greatest id; opening an older run never moves it back.
 */
import type { Database } from 'bun:sqlite';

/** Stores what each person has seen of the reports. */
export interface ReportSeenRepository {
  /**
   * Records that a person opened a run, keeping the latest run they opened of its report.
   *
   * @param userId - Who opened it.
   * @param reportId - The report.
   * @param runId - The run.
   * @param at - When.
   */
  see(userId: string, reportId: string, runId: string, at: number): void;
  /**
   * The latest run a person opened of each report.
   *
   * @param userId - The person.
   * @returns The run ids, by report id.
   */
  seenBy(userId: string): Map<string, string>;
}

/**
 * Creates the repository over an open database.
 *
 * @param database - A database the migrations have run on.
 * @returns The repository.
 */
export function createReportSeenRepository(database: Database): ReportSeenRepository {
  const see = database.query<unknown, [string, string, string, number]>(
    `INSERT INTO report_seen (user_id, report_id, run_id, seen_at) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT (user_id, report_id) DO UPDATE SET run_id = excluded.run_id,
       seen_at = excluded.seen_at
     WHERE excluded.run_id > report_seen.run_id`,
  );
  const seenBy = database.query<{ reportId: string; runId: string }, [string]>(
    'SELECT report_id AS reportId, run_id AS runId FROM report_seen WHERE user_id = ?',
  );
  return {
    see: (userId, reportId, runId, at) => {
      see.run(userId, reportId, runId, at);
    },
    seenBy: (userId) => new Map(seenBy.all(userId).map((row) => [row.reportId, row.runId])),
  };
}
