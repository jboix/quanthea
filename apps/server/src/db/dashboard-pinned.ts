/** Reads the pinned dashboards with their pinned specs, for the search that runs before a model. */
import type { Database } from 'bun:sqlite';

/** A pinned dashboard with its pinned spec. */
export interface PinnedRow {
  /** The dashboard id. */
  readonly dashboardId: string;
  /** The title. */
  readonly title: string;
  /** The description, if any. */
  readonly description: string | null;
  /** The pinned version. */
  readonly version: number;
  /** The pinned spec, parsed from JSON. */
  readonly spec: unknown;
}

/** A pinned dashboard row as SQLite returns it. */
interface StoredPinned {
  /** The dashboard id. */
  dashboard_id: string;
  /** The title. */
  title: string;
  /** The description. */
  description: string | null;
  /** The pinned version. */
  version: number;
  /** The pinned spec, as JSON. */
  spec: string;
}

/**
 * Prepares the listing of pinned dashboards outside the bin.
 *
 * @param database - A database the migrations have run on.
 * @returns Lists them, the most recently changed first.
 */
export function pinnedLister(database: Database): () => PinnedRow[] {
  const select = database.query<StoredPinned, []>(
    `SELECT d.id AS dashboard_id, d.title, d.description, v.version, v.spec
     FROM dashboards d JOIN dashboard_versions v ON v.id = d.pinned_version_id
     WHERE d.deleted_at IS NULL ORDER BY d.updated_at DESC`,
  );
  return () =>
    select.all().map((row) => ({
      dashboardId: row.dashboard_id,
      title: row.title,
      description: row.description,
      version: row.version,
      spec: JSON.parse(row.spec),
    }));
}
