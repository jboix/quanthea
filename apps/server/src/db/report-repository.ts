/**
 * Reads and writes reports and their versions. Versions are never rewritten: a trigger refuses it.
 * Activating chooses a version and sets when it runs next; deactivating stops the schedule.
 */
import type { Database } from 'bun:sqlite';

/** A report, as stored. */
export interface ReportRow {
  /** The id. */
  readonly id: string;
  /** The title of the active version, else of the latest. */
  readonly title: string;
  /** The conversation that made it. */
  readonly threadId: string | null;
  /** The active version. */
  readonly activeVersion: number | null;
  /** The latest version. */
  readonly latestVersion: number;
  /** When its schedule was stopped. */
  readonly deactivatedAt: number | null;
  /** When it runs next; `null` while it is not active. */
  readonly nextRunAt: number | null;
  /** Who made it. */
  readonly createdBy: string;
  /** When. */
  readonly createdAt: number;
  /** When it last changed. */
  readonly updatedAt: number;
}

/** A version of a report, as stored. */
export interface ReportVersionRow {
  /** The report. */
  readonly reportId: string;
  /** The version number. */
  readonly version: number;
  /** The spec, parsed from JSON but not validated. */
  readonly spec: unknown;
  /** What changed, in words. */
  readonly note: string | null;
  /** Who saved it. */
  readonly createdBy: string;
  /** When. */
  readonly createdAt: number;
  /** When it was first activated. */
  readonly activatedAt: number | null;
}

/** A version to add. */
export type NewReportVersion = Omit<ReportVersionRow, 'version' | 'activatedAt'> & {
  /** The title of the spec. */
  readonly title: string;
};

/** Stores reports. */
export interface ReportRepository {
  /**
   * Adds a version, creating the report with its first one when it does not exist.
   *
   * @param version - The version.
   * @param threadId - The conversation that made the report, for a new report.
   * @returns The version number.
   */
  addVersion(version: NewReportVersion, threadId?: string | null): number;
  /**
   * Reads a report.
   *
   * @param id - The id.
   * @returns The report, or `undefined`.
   */
  get(id: string): ReportRow | undefined;
  /**
   * Lists the reports, the newest first.
   *
   * @returns The reports.
   */
  list(): ReportRow[];
  /**
   * Lists the versions of a report, the latest first.
   *
   * @param id - The report.
   * @returns The versions.
   */
  versions(id: string): ReportVersionRow[];
  /**
   * Reads a version.
   *
   * @param id - The report.
   * @param version - The version number.
   * @returns The version, or `undefined`.
   */
  version(id: string, version: number): ReportVersionRow | undefined;
  /**
   * Activates a version and resumes the schedule. The version keeps its first activation time.
   *
   * @param id - The report.
   * @param version - The version.
   * @param at - When.
   * @param nextRunAt - When the version's schedule runs next.
   * @returns Whether the report and version exist.
   */
  activate(id: string, version: number, at: number, nextRunAt: number): boolean;
  /**
   * Stops a report's schedule.
   *
   * @param id - The report.
   * @param at - When.
   * @returns Whether the report exists.
   */
  deactivate(id: string, at: number): boolean;
  /**
   * Lists the active reports whose next run is due, with their active spec.
   *
   * @param now - The current instant.
   * @returns The reports and their specs.
   */
  due(now: number): { readonly report: ReportRow; readonly spec: unknown }[];
  /**
   * Moves a report's next run on, after the scheduler started the one due.
   *
   * @param id - The report.
   * @param nextRunAt - When it runs next.
   */
  setNextRun(id: string, nextRunAt: number): void;
}

/** A report as SQLite returns it. */
interface StoredReport {
  /** The id. */
  id: string;
  /** The title. */
  title: string;
  /** The thread. */
  thread_id: string | null;
  /** The active version. */
  active_version: number | null;
  /** The latest version. */
  latest_version: number;
  /** When deactivated. */
  deactivated_at: number | null;
  /** When it runs next. */
  next_run_at: number | null;
  /** Who made it. */
  created_by: string;
  /** When. */
  created_at: number;
  /** When it changed. */
  updated_at: number;
}

/** A version as SQLite returns it. */
interface StoredVersion {
  /** The report. */
  report_id: string;
  /** The number. */
  version: number;
  /** The spec, JSON. */
  spec: string;
  /** The note. */
  note: string | null;
  /** Who saved it. */
  created_by: string;
  /** When. */
  created_at: number;
  /** When first activated. */
  activated_at: number | null;
}

/** The columns of a report, with its latest version. */
const reportColumns = `r.id, r.title, r.thread_id, r.active_version, r.deactivated_at,
  r.next_run_at, r.created_by, r.created_at, r.updated_at,
  (SELECT max(version) FROM report_versions WHERE report_id = r.id) AS latest_version`;

/** The columns of a version. */
const versionColumns = 'report_id, version, spec, note, created_by, created_at, activated_at';

/**
 * Turns a stored report into a row.
 *
 * @param stored - The stored report.
 * @returns The row.
 */
function reportOf(stored: StoredReport): ReportRow {
  return {
    id: stored.id,
    title: stored.title,
    threadId: stored.thread_id,
    activeVersion: stored.active_version,
    latestVersion: stored.latest_version,
    deactivatedAt: stored.deactivated_at,
    nextRunAt: stored.next_run_at,
    createdBy: stored.created_by,
    createdAt: stored.created_at,
    updatedAt: stored.updated_at,
  };
}

/**
 * Turns a stored version into a row.
 *
 * @param stored - The stored version.
 * @returns The row.
 */
function versionOf(stored: StoredVersion): ReportVersionRow {
  return {
    reportId: stored.report_id,
    version: stored.version,
    spec: JSON.parse(stored.spec),
    note: stored.note,
    createdBy: stored.created_by,
    createdAt: stored.created_at,
    activatedAt: stored.activated_at,
  };
}

/**
 * Prepares the statements that read.
 *
 * @param database - A database the migrations have run on.
 * @returns The statements.
 */
function readStatements(database: Database) {
  return {
    get: database.query<StoredReport, [string]>(
      `SELECT ${reportColumns} FROM reports r WHERE id = ?`,
    ),
    list: database.query<StoredReport, []>(
      `SELECT ${reportColumns} FROM reports r ORDER BY r.created_at DESC, r.id DESC`,
    ),
    versions: database.query<StoredVersion, [string]>(
      `SELECT ${versionColumns} FROM report_versions WHERE report_id = ? ORDER BY version DESC`,
    ),
    version: database.query<StoredVersion, [string, number]>(
      `SELECT ${versionColumns} FROM report_versions WHERE report_id = ? AND version = ?`,
    ),
    due: database.query<StoredReport & { spec: string }, [number]>(
      `SELECT ${reportColumns}, v.spec FROM reports r
         JOIN report_versions v ON v.report_id = r.id AND v.version = r.active_version
       WHERE r.deactivated_at IS NULL AND r.next_run_at <= ? ORDER BY r.next_run_at, r.id`,
    ),
  };
}

/**
 * Prepares the statements that write.
 *
 * @param database - A database the migrations have run on.
 * @returns The statements.
 */
function writeStatements(database: Database) {
  return {
    insertReport: database.query(
      `INSERT INTO reports (id, title, thread_id, created_by, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5) ON CONFLICT (id) DO NOTHING`,
    ),
    nextVersion: database.query<{ next: number }, [string]>(
      'SELECT coalesce(max(version), 0) + 1 AS next FROM report_versions WHERE report_id = ?',
    ),
    insertVersion: database.query(
      `INSERT INTO report_versions (report_id, version, spec, note, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ),
    // A new version names the report until one is active.
    retitle: database.query(
      `UPDATE reports SET title = CASE WHEN active_version IS NULL THEN ?1 ELSE title END,
         updated_at = ?2 WHERE id = ?3`,
    ),
    activate: database.query(
      `UPDATE reports SET active_version = ?1, deactivated_at = NULL, next_run_at = ?4,
         updated_at = ?2,
         title = (SELECT json_extract(spec, '$.title') FROM report_versions
                  WHERE report_id = ?3 AND version = ?1)
       WHERE id = ?3
         AND EXISTS (SELECT 1 FROM report_versions WHERE report_id = ?3 AND version = ?1)`,
    ),
    firstActivation: database.query(
      `UPDATE report_versions SET activated_at = ? WHERE report_id = ? AND version = ?
         AND activated_at IS NULL`,
    ),
    deactivate: database.query(
      'UPDATE reports SET deactivated_at = ?1, next_run_at = NULL, updated_at = ?1 WHERE id = ?2',
    ),
    setNextRun: database.query('UPDATE reports SET next_run_at = ? WHERE id = ?'),
  };
}

/**
 * Builds the transaction that adds a version.
 *
 * @param database - A database the migrations have run on.
 * @param statements - The prepared statements.
 * @returns The method.
 */
function versionAdder(
  database: Database,
  statements: ReturnType<typeof writeStatements>,
): ReportRepository['addVersion'] {
  return database.transaction((version: NewReportVersion, threadId?: string | null): number => {
    const { reportId, title, createdBy, createdAt } = version;
    statements.insertReport.run(reportId, title, threadId ?? null, createdBy, createdAt);
    const number = statements.nextVersion.get(reportId)?.next ?? 1;
    const spec = JSON.stringify(version.spec);
    statements.insertVersion.run(reportId, number, spec, version.note, createdBy, createdAt);
    statements.retitle.run(title, createdAt, reportId);
    return number;
  });
}

/**
 * Builds the transaction that activates a version.
 *
 * @param database - A database the migrations have run on.
 * @param statements - The prepared statements.
 * @returns The method.
 */
function activator(
  database: Database,
  statements: ReturnType<typeof writeStatements>,
): ReportRepository['activate'] {
  return database.transaction(
    (id: string, version: number, at: number, nextRunAt: number): boolean => {
      if (statements.activate.run(version, at, id, nextRunAt).changes === 0) return false;
      statements.firstActivation.run(at, id, version);
      return true;
    },
  );
}

/**
 * Creates the repository over an open database.
 *
 * @param database - A database the migrations have run on.
 * @returns The repository.
 */
export function createReportRepository(database: Database): ReportRepository {
  const read = readStatements(database);
  const write = writeStatements(database);
  return {
    addVersion: versionAdder(database, write),
    get: (id) => {
      const stored = read.get.get(id);
      return stored ? reportOf(stored) : undefined;
    },
    list: () => read.list.all().map(reportOf),
    versions: (id) => read.versions.all(id).map(versionOf),
    version: (id, version) => {
      const stored = read.version.get(id, version);
      return stored ? versionOf(stored) : undefined;
    },
    activate: activator(database, write),
    deactivate: (id, at) => write.deactivate.run(at, id).changes > 0,
    due: (now) =>
      read.due
        .all(now)
        .map((stored) => ({ report: reportOf(stored), spec: JSON.parse(stored.spec) })),
    setNextRun: (id, nextRunAt) => {
      write.setNextRun.run(nextRunAt, id);
    },
  };
}
