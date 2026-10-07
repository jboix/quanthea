/**
 * Reads and writes the layouts of dashboard versions. A revision is stored once and never changed
 * (the trigger in `migrations/0003-version-trigger-and-layouts.sql`); saving adds a revision, and
 * the latest is the one shown.
 */
import type { Database } from 'bun:sqlite';

/** A layout revision as stored, its layout parsed but not validated. */
export interface LayoutRow {
  /** The id, a ULID. */
  readonly id: string;
  /** The dashboard. */
  readonly dashboardId: string;
  /** The version laid out. */
  readonly version: number;
  /** The revision, from 1 for each version. */
  readonly revision: number;
  /** The layout. */
  readonly layout: unknown;
  /** The revision it copies, when it restores one. */
  readonly restoredFrom: number | null;
  /** Who saved it, by user id. */
  readonly actor: string;
  /** When, in epoch milliseconds. */
  readonly createdAt: number;
}

/** A revision to add: the repository numbers it. */
export type NewLayout = Omit<LayoutRow, 'revision'>;

/** Stores layouts. */
export interface LayoutRepository {
  /**
   * Adds a revision after the latest one, unless another was added since the one it is based on.
   *
   * @param row - The revision.
   * @param basedOn - The latest revision the change started from, or `null` for none.
   * @returns The stored revision, or `undefined` when the latest is no longer `basedOn`.
   */
  add(row: NewLayout, basedOn: number | null): LayoutRow | undefined;
  /**
   * Reads the latest revision of a version's layout.
   *
   * @param dashboardId - The dashboard.
   * @param version - The version.
   * @returns The revision, or `undefined` when the version has none.
   */
  latest(dashboardId: string, version: number): LayoutRow | undefined;
  /**
   * Reads every revision of a version's layout.
   *
   * @param dashboardId - The dashboard.
   * @param version - The version.
   * @returns The revisions, latest first.
   */
  history(dashboardId: string, version: number): LayoutRow[];
}

/** A revision as SQLite returns it. */
interface StoredLayout {
  /** The id. */
  id: string;
  /** The dashboard. */
  dashboard_id: string;
  /** The version. */
  version: number;
  /** The revision. */
  revision: number;
  /** The layout, JSON. */
  layout: string;
  /** The revision it copies. */
  restored_from: number | null;
  /** Who saved it. */
  actor: string;
  /** When. */
  created_at: number;
}

/** The columns of a revision, in the order of the insert. */
const columns = 'id, dashboard_id, version, revision, layout, restored_from, actor, created_at';

/**
 * Turns a stored revision into a row.
 *
 * @param stored - The stored revision.
 * @returns The row.
 */
function rowOf(stored: StoredLayout): LayoutRow {
  return {
    id: stored.id,
    dashboardId: stored.dashboard_id,
    version: stored.version,
    revision: stored.revision,
    layout: JSON.parse(stored.layout),
    restoredFrom: stored.restored_from,
    actor: stored.actor,
    createdAt: stored.created_at,
  };
}

/**
 * Creates the repository over an open database.
 *
 * @param database - A database the migrations have run on.
 * @returns The repository.
 */
export function createLayoutRepository(database: Database): LayoutRepository {
  const insert = database.query(
    `INSERT INTO dashboard_layouts (${columns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const select = `SELECT ${columns} FROM dashboard_layouts WHERE dashboard_id = ? AND version = ?`;
  const latest = database.query<StoredLayout, [string, number]>(
    `${select} ORDER BY revision DESC LIMIT 1`,
  );
  const history = database.query<StoredLayout, [string, number]>(
    `${select} ORDER BY revision DESC`,
  );
  const readLatest = (dashboardId: string, version: number) => {
    const stored = latest.get(dashboardId, version);
    return stored ? rowOf(stored) : undefined;
  };
  const add = database.transaction((row: NewLayout, basedOn: number | null) => {
    const current = readLatest(row.dashboardId, row.version)?.revision ?? null;
    if (current !== basedOn) return undefined;
    const stored = { ...row, revision: (current ?? 0) + 1 };
    const { id, dashboardId, version, revision, restoredFrom, actor, createdAt } = stored;
    const layout = JSON.stringify(row.layout);
    insert.run(id, dashboardId, version, revision, layout, restoredFrom, actor, createdAt);
    return stored;
  });
  return {
    add: (row, basedOn) => add(row, basedOn),
    latest: readLatest,
    history: (dashboardId, version) => history.all(dashboardId, version).map(rowOf),
  };
}
