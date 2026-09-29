/** Reads and writes dashboards and their versions. */
import type { Database } from 'bun:sqlite';
import { type PinnedRow, pinnedLister } from './dashboard-pinned.ts';

/** A dashboard as stored. */
export interface DashboardRow {
  /** The ULID. */
  readonly id: string;
  /** The title: the spec's, or the one written when it was pinned. */
  readonly title: string;
  /** One line about it, if any. */
  readonly description: string | null;
  /** Tags for search. */
  readonly tags: readonly string[];
  /** The dashboard this one is a variant of, if any. */
  readonly parentDashboardId: string | null;
  /** The parent's version it was copied from. */
  readonly parentVersion: number | null;
  /** The id of the pinned version, if any. */
  readonly pinnedVersionId: string | null;
  /** When it was moved to the bin, in epoch milliseconds. */
  readonly deletedAt: number | null;
  /** Creation time, in epoch milliseconds. */
  readonly createdAt: number;
  /** Last change, in epoch milliseconds. */
  readonly updatedAt: number;
}

/** A version as stored. */
export interface VersionRow {
  /** The ULID. */
  readonly id: string;
  /** The dashboard. */
  readonly dashboardId: string;
  /** The version number, from 1. */
  readonly version: number;
  /** The spec, parsed from JSON but not validated. */
  readonly spec: unknown;
  /** What changed, in one line. */
  readonly changeSummary: string | null;
  /** When it was pinned, in epoch milliseconds. */
  readonly pinnedAt: number | null;
  /** Who made it. */
  readonly actor: string | null;
  /** Creation time, in epoch milliseconds. */
  readonly createdAt: number;
}

/** A version without its spec, for history lists. */
export type VersionSummaryRow = Omit<VersionRow, 'spec'>;

/** What pinning writes on the dashboard. */
export interface PinChange {
  /** The version to pin. */
  readonly versionId: string;
  /** When. */
  readonly at: number;
  /** The title to show from now on. */
  readonly title: string;
  /** The description to show from now on. */
  readonly description: string | null;
  /** The tags to search by. */
  readonly tags: readonly string[];
}

/** Stores dashboards and versions. */
export interface DashboardRepository {
  /**
   * Inserts a dashboard with its first version, in one transaction.
   *
   * @param dashboard - The dashboard.
   * @param version - Its first version.
   */
  create(dashboard: DashboardRow, version: VersionRow): void;
  /**
   * Finds a dashboard.
   *
   * @param id - The dashboard id.
   * @returns The dashboard, or `undefined`.
   */
  get(id: string): DashboardRow | undefined;
  /**
   * Lists the versions of a dashboard, without their specs.
   *
   * @param dashboardId - The dashboard id.
   * @returns The versions, oldest first.
   */
  listVersions(dashboardId: string): VersionSummaryRow[];
  /**
   * Reads one version.
   *
   * @param dashboardId - The dashboard id.
   * @param version - The version number.
   * @returns The version, or `undefined`.
   */
  getVersion(dashboardId: string, version: number): VersionRow | undefined;
  /**
   * Pins a version and records it on the dashboard, in one transaction.
   *
   * @param dashboardId - The dashboard id.
   * @param change - The version, time, title, description and tags.
   * @returns `false` when the version was already pinned or does not belong to the dashboard.
   */
  pin(dashboardId: string, change: PinChange): boolean;
  /**
   * Adds a version after the latest one and records the change on the dashboard, in one
   * transaction.
   *
   * @param version - The version, without its number.
   * @returns The new version number.
   */
  addVersion(version: Omit<VersionRow, 'version'>): number;
  /**
   * Lists the pinned dashboards outside the bin, with their pinned specs.
   *
   * @returns The dashboards, the most recently changed first.
   */
  listPinned(): PinnedRow[];
}

/** A `dashboards` row as SQLite returns it. */
interface StoredDashboard {
  /** The id. */
  id: string;
  /** The title. */
  title: string;
  /** The description. */
  description: string | null;
  /** The tags JSON. */
  tags: string;
  /** The parent. */
  parent_dashboard_id: string | null;
  /** The parent version. */
  parent_version: number | null;
  /** The pinned version. */
  pinned_version_id: string | null;
  /** The bin time. */
  deleted_at: number | null;
  /** Creation time. */
  created_at: number;
  /** Last change. */
  updated_at: number;
}

/** A `dashboard_versions` row as SQLite returns it. */
interface StoredVersion {
  /** The id. */
  id: string;
  /** The dashboard. */
  dashboard_id: string;
  /** The version number. */
  version: number;
  /** The spec JSON, absent in history lists. */
  spec?: string;
  /** The change summary. */
  change_summary: string | null;
  /** The pin time. */
  pinned_at: number | null;
  /** The actor. */
  actor: string | null;
  /** Creation time. */
  created_at: number;
}

/**
 * Turns a stored row into a dashboard.
 *
 * @param stored - The row.
 * @returns The dashboard.
 */
function toDashboard(stored: StoredDashboard): DashboardRow {
  return {
    id: stored.id,
    title: stored.title,
    description: stored.description,
    tags: JSON.parse(stored.tags) as string[],
    parentDashboardId: stored.parent_dashboard_id,
    parentVersion: stored.parent_version,
    pinnedVersionId: stored.pinned_version_id,
    deletedAt: stored.deleted_at,
    createdAt: stored.created_at,
    updatedAt: stored.updated_at,
  };
}

/**
 * Turns a stored row into a version summary.
 *
 * @param stored - The row.
 * @returns The version without its spec.
 */
function toVersionSummary(stored: StoredVersion): VersionSummaryRow {
  return {
    id: stored.id,
    dashboardId: stored.dashboard_id,
    version: stored.version,
    changeSummary: stored.change_summary,
    pinnedAt: stored.pinned_at,
    actor: stored.actor,
    createdAt: stored.created_at,
  };
}

/**
 * Prepares the statements that write.
 *
 * @param database - The database.
 * @returns The insert and pin statements.
 */
function writeStatements(database: Database) {
  return {
    insertDashboard: database.query(
      `INSERT INTO dashboards (id, title, description, tags, parent_dashboard_id, parent_version,
         pinned_version_id, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    insertVersion: database.query(
      `INSERT INTO dashboard_versions (id, dashboard_id, version, spec, change_summary, pinned_at,
         actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    pinVersion: database.query(
      'UPDATE dashboard_versions SET pinned_at = ? WHERE id = ? AND dashboard_id = ? AND pinned_at IS NULL',
    ),
    nextVersion: database.query<{ next: number }, [string]>(
      'SELECT coalesce(max(version), 0) + 1 AS next FROM dashboard_versions WHERE dashboard_id = ?',
    ),
    touchDashboard: database.query('UPDATE dashboards SET updated_at = ? WHERE id = ?'),
    pinDashboard: database.query(
      `UPDATE dashboards SET pinned_version_id = ?, title = ?, description = ?, tags = ?,
         updated_at = ? WHERE id = ?`,
    ),
  };
}

/**
 * Builds the transaction that inserts a dashboard with its first version.
 *
 * @param database - A database the migrations have run on.
 * @param statements - The prepared statements.
 * @returns The create method.
 */
function creator(
  database: Database,
  statements: ReturnType<typeof writeStatements>,
): DashboardRepository['create'] {
  return database.transaction((dashboard: DashboardRow, version: VersionRow) => {
    const { insertDashboard, insertVersion } = statements;
    insertDashboard.run(
      dashboard.id,
      dashboard.title,
      dashboard.description,
      JSON.stringify(dashboard.tags),
      dashboard.parentDashboardId,
      dashboard.parentVersion,
      dashboard.pinnedVersionId,
      dashboard.deletedAt,
      dashboard.createdAt,
      dashboard.updatedAt,
    );
    insertVersion.run(
      version.id,
      version.dashboardId,
      version.version,
      JSON.stringify(version.spec),
      version.changeSummary,
      version.pinnedAt,
      version.actor,
      version.createdAt,
    );
  });
}

/**
 * Builds the transaction that pins a version.
 *
 * @param database - A database the migrations have run on.
 * @param statements - The prepared statements.
 * @returns The pin method.
 */
function pinner(
  database: Database,
  statements: ReturnType<typeof writeStatements>,
): DashboardRepository['pin'] {
  return database.transaction((dashboardId: string, change: PinChange): boolean => {
    const pinned = statements.pinVersion.run(change.at, change.versionId, dashboardId);
    if (pinned.changes === 0) return false;
    statements.pinDashboard.run(
      change.versionId,
      change.title,
      change.description,
      JSON.stringify(change.tags),
      change.at,
      dashboardId,
    );
    return true;
  });
}

/**
 * Builds the transaction that adds a version after the latest one.
 *
 * @param database - A database the migrations have run on.
 * @param statements - The prepared statements.
 * @returns The add method.
 */
function versionAdder(
  database: Database,
  statements: ReturnType<typeof writeStatements>,
): DashboardRepository['addVersion'] {
  return database.transaction((version: Omit<VersionRow, 'version'>): number => {
    const number = statements.nextVersion.get(version.dashboardId)?.next ?? 1;
    statements.insertVersion.run(
      version.id,
      version.dashboardId,
      number,
      JSON.stringify(version.spec),
      version.changeSummary,
      version.pinnedAt,
      version.actor,
      version.createdAt,
    );
    statements.touchDashboard.run(version.createdAt, version.dashboardId);
    return number;
  });
}

/**
 * Prepares the statements that read.
 *
 * @param database - The database.
 * @returns The select statements.
 */
function readStatements(database: Database) {
  return {
    selectDashboard: database.query<StoredDashboard, [string]>(
      'SELECT * FROM dashboards WHERE id = ?',
    ),
    selectVersions: database.query<StoredVersion, [string]>(
      `SELECT id, dashboard_id, version, change_summary, pinned_at, actor, created_at
       FROM dashboard_versions WHERE dashboard_id = ? ORDER BY version`,
    ),
    selectVersion: database.query<StoredVersion, [string, number]>(
      'SELECT * FROM dashboard_versions WHERE dashboard_id = ? AND version = ?',
    ),
  };
}

/**
 * Creates the repository over an open database.
 *
 * @param database - A database the migrations have run on.
 * @returns The repository.
 */
export function createDashboardRepository(database: Database): DashboardRepository {
  const statements = writeStatements(database);
  const reads = readStatements(database);
  return {
    create: creator(database, statements),
    pin: pinner(database, statements),
    addVersion: versionAdder(database, statements),
    get: (id) => {
      const stored = reads.selectDashboard.get(id);
      return stored ? toDashboard(stored) : undefined;
    },
    listVersions: (dashboardId) => reads.selectVersions.all(dashboardId).map(toVersionSummary),
    getVersion: (dashboardId, version) => {
      const stored = reads.selectVersion.get(dashboardId, version);
      return stored
        ? { ...toVersionSummary(stored), spec: JSON.parse(stored.spec ?? 'null') }
        : undefined;
    },
    listPinned: pinnedLister(database),
  };
}
