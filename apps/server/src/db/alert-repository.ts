/**
 * Reads and writes alerts and their versions. Versions are never rewritten: a trigger refuses it.
 * Activating chooses a version; deactivating and muting change the alert row only.
 */
import type { Database } from 'bun:sqlite';

/** An alert, as stored. */
export interface AlertRow {
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
  /** When evaluation was stopped. */
  readonly deactivatedAt: number | null;
  /** When it was muted. */
  readonly mutedAt: number | null;
  /** Who muted it. */
  readonly mutedBy: string | null;
  /** Until when; `null` with `mutedAt` set: until someone unmutes. */
  readonly mutedUntil: number | null;
  /** When it was last evaluated. */
  readonly evaluatedAt: number | null;
  /** Who made it. */
  readonly createdBy: string;
  /** When. */
  readonly createdAt: number;
  /** When it last changed. */
  readonly updatedAt: number;
}

/** A version of an alert, as stored. */
export interface AlertVersionRow {
  /** The alert. */
  readonly alertId: string;
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
export interface NewAlertVersion {
  /** The alert. */
  readonly alertId: string;
  /** The title of the spec. */
  readonly title: string;
  /** The spec. */
  readonly spec: unknown;
  /** What changed, in words. */
  readonly note: string | null;
  /** Who saves it. */
  readonly createdBy: string;
  /** When. */
  readonly createdAt: number;
}

/** A mute. */
export interface MuteChange {
  /** When. */
  readonly at: number;
  /** Who mutes. */
  readonly by: string;
  /** Until when; `null` until someone unmutes. */
  readonly until: number | null;
}

/** Stores alerts. */
export interface AlertRepository {
  /**
   * Adds a version, creating the alert with its first one when it does not exist.
   *
   * @param version - The version.
   * @param threadId - The conversation that made the alert, for a new alert.
   * @returns The version number.
   */
  addVersion(version: NewAlertVersion, threadId?: string | null): number;
  /**
   * Reads an alert.
   *
   * @param id - The id.
   * @returns The alert, or `undefined`.
   */
  get(id: string): AlertRow | undefined;
  /**
   * Lists the alerts, the newest first.
   *
   * @returns The alerts.
   */
  list(): AlertRow[];
  /**
   * Lists the versions of an alert, the latest first.
   *
   * @param id - The alert.
   * @returns The versions.
   */
  versions(id: string): AlertVersionRow[];
  /**
   * Reads a version.
   *
   * @param id - The alert.
   * @param version - The version number.
   * @returns The version, or `undefined`.
   */
  version(id: string, version: number): AlertVersionRow | undefined;
  /**
   * Activates a version and resumes evaluation. The version keeps its first activation time.
   *
   * @param id - The alert.
   * @param version - The version.
   * @param at - When.
   * @returns Whether the alert and version exist.
   */
  activate(id: string, version: number, at: number): boolean;
  /**
   * Stops evaluating an alert.
   *
   * @param id - The alert.
   * @param at - When.
   * @returns Whether the alert exists.
   */
  deactivate(id: string, at: number): boolean;
  /**
   * Mutes or unmutes an alert.
   *
   * @param id - The alert.
   * @param change - The mute, or `null` to unmute.
   * @param at - When.
   * @returns Whether the alert exists.
   */
  setMute(id: string, change: MuteChange | null, at: number): boolean;
  /**
   * Lists the alerts being evaluated, with the spec of their active version.
   *
   * @returns The alerts and their specs.
   */
  evaluated(): { readonly alert: AlertRow; readonly spec: unknown }[];
}

/** An alert as SQLite returns it. */
interface StoredAlert {
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
  /** When muted. */
  muted_at: number | null;
  /** By whom. */
  muted_by: string | null;
  /** Until when. */
  muted_until: number | null;
  /** When evaluated. */
  evaluated_at: number | null;
  /** Who made it. */
  created_by: string;
  /** When. */
  created_at: number;
  /** When it changed. */
  updated_at: number;
}

/** A version as SQLite returns it. */
interface StoredVersion {
  /** The alert. */
  alert_id: string;
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

/** The columns of an alert, with its latest version. */
const alertColumns = `a.id, a.title, a.thread_id, a.active_version, a.deactivated_at, a.muted_at,
  a.muted_by, a.muted_until, a.evaluated_at, a.created_by, a.created_at, a.updated_at,
  (SELECT max(version) FROM alert_versions WHERE alert_id = a.id) AS latest_version`;

/**
 * Turns a stored alert into a row.
 *
 * @param stored - The stored alert.
 * @returns The row.
 */
function alertOf(stored: StoredAlert): AlertRow {
  return {
    id: stored.id,
    title: stored.title,
    threadId: stored.thread_id,
    activeVersion: stored.active_version,
    latestVersion: stored.latest_version,
    deactivatedAt: stored.deactivated_at,
    mutedAt: stored.muted_at,
    mutedBy: stored.muted_by,
    mutedUntil: stored.muted_until,
    evaluatedAt: stored.evaluated_at,
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
function versionOf(stored: StoredVersion): AlertVersionRow {
  return {
    alertId: stored.alert_id,
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
  const versionColumns = 'alert_id, version, spec, note, created_by, created_at, activated_at';
  return {
    get: database.query<StoredAlert, [string]>(`SELECT ${alertColumns} FROM alerts a WHERE id = ?`),
    list: database.query<StoredAlert, []>(
      `SELECT ${alertColumns} FROM alerts a ORDER BY a.created_at DESC, a.id DESC`,
    ),
    versions: database.query<StoredVersion, [string]>(
      `SELECT ${versionColumns} FROM alert_versions WHERE alert_id = ? ORDER BY version DESC`,
    ),
    version: database.query<StoredVersion, [string, number]>(
      `SELECT ${versionColumns} FROM alert_versions WHERE alert_id = ? AND version = ?`,
    ),
    evaluated: database.query<StoredAlert & { spec: string }, []>(
      `SELECT ${alertColumns}, v.spec FROM alerts a
         JOIN alert_versions v ON v.alert_id = a.id AND v.version = a.active_version
       WHERE a.deactivated_at IS NULL ORDER BY a.id`,
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
    insertAlert: database.query(
      `INSERT INTO alerts (id, title, thread_id, created_by, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5) ON CONFLICT (id) DO NOTHING`,
    ),
    nextVersion: database.query<{ next: number }, [string]>(
      'SELECT coalesce(max(version), 0) + 1 AS next FROM alert_versions WHERE alert_id = ?',
    ),
    insertVersion: database.query(
      `INSERT INTO alert_versions (alert_id, version, spec, note, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ),
    // A new version names the alert until one is active.
    retitle: database.query(
      `UPDATE alerts SET title = CASE WHEN active_version IS NULL THEN ?1 ELSE title END,
         updated_at = ?2 WHERE id = ?3`,
    ),
    activate: database.query(
      `UPDATE alerts SET active_version = ?1, deactivated_at = NULL, updated_at = ?2,
         title = (SELECT json_extract(spec, '$.title') FROM alert_versions
                  WHERE alert_id = ?3 AND version = ?1)
       WHERE id = ?3 AND EXISTS (SELECT 1 FROM alert_versions WHERE alert_id = ?3 AND version = ?1)`,
    ),
    firstActivation: database.query(
      `UPDATE alert_versions SET activated_at = ? WHERE alert_id = ? AND version = ?
         AND activated_at IS NULL`,
    ),
    deactivate: database.query(
      'UPDATE alerts SET deactivated_at = ?1, updated_at = ?1 WHERE id = ?2',
    ),
    mute: database.query(
      `UPDATE alerts SET muted_at = ?, muted_by = ?, muted_until = ?, updated_at = ? WHERE id = ?`,
    ),
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
): AlertRepository['addVersion'] {
  return database.transaction((version: NewAlertVersion, threadId?: string | null): number => {
    const { alertId, title, createdBy, createdAt } = version;
    statements.insertAlert.run(alertId, title, threadId ?? null, createdBy, createdAt);
    const number = statements.nextVersion.get(alertId)?.next ?? 1;
    const spec = JSON.stringify(version.spec);
    statements.insertVersion.run(alertId, number, spec, version.note, createdBy, createdAt);
    statements.retitle.run(title, createdAt, alertId);
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
): AlertRepository['activate'] {
  return database.transaction((id: string, version: number, at: number): boolean => {
    if (statements.activate.run(version, at, id).changes === 0) return false;
    statements.firstActivation.run(at, id, version);
    return true;
  });
}

/**
 * Creates the repository over an open database.
 *
 * @param database - A database the migrations have run on.
 * @returns The repository.
 */
export function createAlertRepository(database: Database): AlertRepository {
  const read = readStatements(database);
  const write = writeStatements(database);
  return {
    addVersion: versionAdder(database, write),
    get: (id) => {
      const stored = read.get.get(id);
      return stored ? alertOf(stored) : undefined;
    },
    list: () => read.list.all().map(alertOf),
    versions: (id) => read.versions.all(id).map(versionOf),
    version: (id, version) => {
      const stored = read.version.get(id, version);
      return stored ? versionOf(stored) : undefined;
    },
    activate: activator(database, write),
    deactivate: (id, at) => write.deactivate.run(at, id).changes > 0,
    setMute: (id, change, at) =>
      write.mute.run(change?.at ?? null, change?.by ?? null, change?.until ?? null, at, id)
        .changes > 0,
    evaluated: () =>
      read.evaluated
        .all()
        .map((stored) => ({ alert: alertOf(stored), spec: JSON.parse(stored.spec) })),
  };
}
