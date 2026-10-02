/**
 * Reads and writes snapshots. Every read takes the current time and skips the snapshots whose time
 * is up, so an expired snapshot is gone before the purge deletes it.
 */
import type { Database } from 'bun:sqlite';

/** A snapshot without its data, as stored. */
export interface SnapshotSummaryRow {
  /** The unguessable id. */
  readonly id: string;
  /** The dashboard. */
  readonly dashboardId: string;
  /** The version. */
  readonly version: number;
  /** The version's title when it was taken. */
  readonly title: string;
  /** The start of the time range, in epoch milliseconds. */
  readonly timeFrom: number;
  /** The end of the time range, in epoch milliseconds. */
  readonly timeTo: number;
  /** The variable values, parsed from JSON but not validated. */
  readonly variables: unknown;
  /** The ids of the hidden sets of markers, parsed from JSON but not validated. */
  readonly hiddenMarkers: unknown;
  /** The size of the stored spec and runs, in bytes. */
  readonly bytes: number;
  /** Who took it. */
  readonly takenBy: string;
  /** When, in epoch milliseconds. */
  readonly takenAt: number;
  /** When it goes, or `null` to live until revoked. */
  readonly expiresAt: number | null;
}

/** A snapshot with its data, as stored. */
export interface SnapshotRow extends SnapshotSummaryRow {
  /** The spec, parsed from JSON but not validated. */
  readonly spec: unknown;
  /** Each panel's run by panel id, parsed from JSON but not validated. */
  readonly panels: unknown;
}

/** A snapshot to store, its data already written as JSON. */
export interface NewSnapshotRow extends Omit<SnapshotRow, 'variables' | 'hiddenMarkers'> {
  /** The variable values. */
  readonly variables: unknown;
  /** The ids of the hidden sets of markers. */
  readonly hiddenMarkers: readonly string[];
  /** The spec, as JSON. */
  readonly spec: string;
  /** Each panel's run by panel id, as JSON. */
  readonly panels: string;
}

/** Stores snapshots. */
export interface SnapshotRepository {
  /**
   * Stores a snapshot.
   *
   * @param row - The snapshot.
   */
  insert(row: NewSnapshotRow): void;
  /**
   * Reads a live snapshot.
   *
   * @param id - The id.
   * @param now - The current time.
   * @returns The snapshot, or `undefined` when there is none or its time is up.
   */
  get(id: string, now: number): SnapshotRow | undefined;
  /**
   * Lists the live snapshots, the newest first.
   *
   * @param now - The current time.
   * @param dashboardId - Only this dashboard's, when given.
   * @returns The snapshots, without their data.
   */
  list(now: number, dashboardId?: string): SnapshotSummaryRow[];
  /**
   * Deletes a live snapshot.
   *
   * @param id - The id.
   * @param now - The current time.
   * @returns The dashboard it froze, or `undefined` when there was no live snapshot.
   */
  remove(id: string, now: number): string | undefined;
  /**
   * Deletes the snapshots whose time is up.
   *
   * @param now - The current time.
   * @returns How many it deleted.
   */
  removeExpired(now: number): number;
}

/** A snapshot as SQLite returns it. */
interface StoredSummary {
  /** The id. */
  id: string;
  /** The dashboard. */
  dashboard_id: string;
  /** The version. */
  version: number;
  /** The title. */
  title: string;
  /** The start of the range. */
  time_from: number;
  /** The end of the range. */
  time_to: number;
  /** The variable values, JSON. */
  variables: string;
  /** The hidden sets of markers, JSON. */
  hidden_markers: string;
  /** The size. */
  bytes: number;
  /** Who took it. */
  taken_by: string;
  /** When. */
  taken_at: number;
  /** When it goes. */
  expires_at: number | null;
}

/** A snapshot with its data as SQLite returns it. */
interface StoredSnapshot extends StoredSummary {
  /** The spec, JSON. */
  spec: string;
  /** The runs, JSON. */
  panels: string;
}

/** The columns of a summary. */
const summaryColumns = `id, dashboard_id, version, title, time_from, time_to, variables,
  hidden_markers, bytes, taken_by, taken_at, expires_at`;

/** Keeps the snapshots whose time is not up; the current time is the last parameter. */
const live = '(expires_at IS NULL OR expires_at > ?)';

/**
 * Turns a stored summary into a row.
 *
 * @param stored - The stored summary.
 * @returns The row.
 */
function summaryOf(stored: StoredSummary): SnapshotSummaryRow {
  return {
    id: stored.id,
    dashboardId: stored.dashboard_id,
    version: stored.version,
    title: stored.title,
    timeFrom: stored.time_from,
    timeTo: stored.time_to,
    variables: JSON.parse(stored.variables),
    hiddenMarkers: JSON.parse(stored.hidden_markers),
    bytes: stored.bytes,
    takenBy: stored.taken_by,
    takenAt: stored.taken_at,
    expiresAt: stored.expires_at,
  };
}

/**
 * Prepares the statements.
 *
 * @param database - A database the migrations have run on.
 * @returns The statements.
 */
function snapshotStatements(database: Database) {
  return {
    insert: database.query(
      `INSERT INTO snapshots (id, dashboard_id, version, title, time_from, time_to, variables,
         hidden_markers, spec, panels, bytes, taken_by, taken_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    get: database.query<StoredSnapshot, [string, number]>(
      `SELECT ${summaryColumns}, spec, panels FROM snapshots WHERE id = ? AND ${live}`,
    ),
    list: database.query<StoredSummary, [number]>(
      `SELECT ${summaryColumns} FROM snapshots WHERE ${live} ORDER BY taken_at DESC, id`,
    ),
    listOf: database.query<StoredSummary, [string, number]>(
      `SELECT ${summaryColumns} FROM snapshots WHERE dashboard_id = ? AND ${live}
       ORDER BY taken_at DESC, id`,
    ),
    remove: database.query<{ dashboard_id: string }, [string, number]>(
      `DELETE FROM snapshots WHERE id = ? AND ${live} RETURNING dashboard_id`,
    ),
    removeExpired: database.query('DELETE FROM snapshots WHERE expires_at <= ?'),
  };
}

/**
 * Builds the insert of a snapshot.
 *
 * @param statements - The prepared statements.
 * @returns The insert method.
 */
function inserter(statements: ReturnType<typeof snapshotStatements>): SnapshotRepository['insert'] {
  return (row) => {
    const place = [row.id, row.dashboardId, row.version, row.title, row.timeFrom, row.timeTo];
    const choices = [JSON.stringify(row.variables), JSON.stringify(row.hiddenMarkers)];
    const data = [row.spec, row.panels, row.bytes, row.takenBy, row.takenAt, row.expiresAt];
    statements.insert.run(...place, ...choices, ...data);
  };
}

/**
 * Builds the read of one live snapshot with its data.
 *
 * @param statements - The prepared statements.
 * @returns The get method.
 */
function reader(statements: ReturnType<typeof snapshotStatements>): SnapshotRepository['get'] {
  return (id, now) => {
    const stored = statements.get.get(id, now);
    if (!stored) return undefined;
    const data = { spec: JSON.parse(stored.spec), panels: JSON.parse(stored.panels) };
    return { ...summaryOf(stored), ...data };
  };
}

/**
 * Creates the repository over an open database.
 *
 * @param database - A database the migrations have run on.
 * @returns The repository.
 */
export function createSnapshotRepository(database: Database): SnapshotRepository {
  const statements = snapshotStatements(database);
  return {
    insert: inserter(statements),
    get: reader(statements),
    list: (now, dashboardId) =>
      (dashboardId === undefined
        ? statements.list.all(now)
        : statements.listOf.all(dashboardId, now)
      ).map(summaryOf),
    remove: (id, now) => statements.remove.get(id, now)?.dashboard_id,
    removeExpired: (now) => statements.removeExpired.run(now).changes,
  };
}
