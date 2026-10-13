/**
 * Reads and writes the layouts of the versions of dashboards and of reports, each kind in its own
 * table of the same shape. A revision is stored once and never changed (a trigger on each table);
 * saving adds a revision, and the latest is the one shown.
 */
import type { Database } from 'bun:sqlite';

/** A layout revision as stored, its layout parsed but not validated. */
export interface LayoutRow {
  /** The id, a ULID. */
  readonly id: string;
  /** The dashboard or the report. */
  readonly subjectId: string;
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
   * @param subjectId - The dashboard or the report.
   * @param version - The version.
   * @returns The revision, or `undefined` when the version has none.
   */
  latest(subjectId: string, version: number): LayoutRow | undefined;
  /**
   * Reads every revision of a version's layout.
   *
   * @param subjectId - The dashboard or the report.
   * @param version - The version.
   * @returns The revisions, latest first.
   */
  history(subjectId: string, version: number): LayoutRow[];
}

/** Whose layouts a repository stores. */
type LayoutKind = 'dashboard' | 'report';

/** A revision as SQLite returns it. */
interface StoredLayout {
  /** The id. */
  id: string;
  /** The dashboard or the report. */
  subject_id: string;
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

/** The table of each kind, and the column that names what is laid out. */
const tables: Readonly<Record<LayoutKind, { readonly table: string; readonly subject: string }>> = {
  dashboard: { table: 'dashboard_layouts', subject: 'dashboard_id' },
  report: { table: 'report_layouts', subject: 'report_id' },
};

/** The columns of a revision after the one that names what is laid out, in the insert's order. */
const columns = 'version, revision, layout, restored_from, actor, created_at';

/**
 * Turns a stored revision into a row.
 *
 * @param stored - The stored revision.
 * @returns The row.
 */
function rowOf(stored: StoredLayout): LayoutRow {
  return {
    id: stored.id,
    subjectId: stored.subject_id,
    version: stored.version,
    revision: stored.revision,
    layout: JSON.parse(stored.layout),
    restoredFrom: stored.restored_from,
    actor: stored.actor,
    createdAt: stored.created_at,
  };
}

/**
 * Prepares the statements that read and add the revisions of one kind's layouts.
 *
 * @param database - The database.
 * @param kind - Whose layouts.
 * @returns The insert, and the reads of the latest revision and of every revision of a version.
 */
function statements(database: Database, kind: LayoutKind) {
  const { table, subject } = tables[kind];
  const select = `SELECT id, ${subject} AS subject_id, ${columns} FROM ${table}
    WHERE ${subject} = ? AND version = ?`;
  return {
    insert: database.query(
      `INSERT INTO ${table} (id, ${subject}, ${columns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    latest: database.query<StoredLayout, [string, number]>(
      `${select} ORDER BY revision DESC LIMIT 1`,
    ),
    history: database.query<StoredLayout, [string, number]>(`${select} ORDER BY revision DESC`),
  };
}

/**
 * Creates the repository of one kind's layouts over an open database.
 *
 * @param database - A database the migrations have run on.
 * @param kind - Whose layouts: dashboards' by default.
 * @returns The repository.
 */
export function createLayoutRepository(
  database: Database,
  kind: LayoutKind = 'dashboard',
): LayoutRepository {
  const { insert, latest, history } = statements(database, kind);
  const readLatest = (subjectId: string, version: number) => {
    const stored = latest.get(subjectId, version);
    return stored ? rowOf(stored) : undefined;
  };
  const add = database.transaction((row: NewLayout, basedOn: number | null) => {
    const current = readLatest(row.subjectId, row.version)?.revision ?? null;
    if (current !== basedOn) return undefined;
    const stored = { ...row, revision: (current ?? 0) + 1 };
    const { id, subjectId, version, revision, restoredFrom, actor, createdAt } = stored;
    const layout = JSON.stringify(row.layout);
    insert.run(id, subjectId, version, revision, layout, restoredFrom, actor, createdAt);
    return stored;
  });
  return {
    add: (row, basedOn) => add(row, basedOn),
    latest: readLatest,
    history: (subjectId, version) => history.all(subjectId, version).map(rowOf),
  };
}
