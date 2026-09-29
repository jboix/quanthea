/** Reads the pinned dashboards with their pinned specs, for the library and the search before a model. */
import type { Database } from 'bun:sqlite';

/** A pinned dashboard with its pinned spec. */
export interface PinnedRow {
  /** The dashboard id. */
  readonly dashboardId: string;
  /** The title. */
  readonly title: string;
  /** The description, if any. */
  readonly description: string | null;
  /** The tags. */
  readonly tags: readonly string[];
  /** The dashboard it was copied from, if any. */
  readonly parentDashboardId: string | null;
  /** The pinned version. */
  readonly version: number;
  /** When that version was pinned. */
  readonly pinnedAt: number;
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
  /** The tags, as JSON. */
  tags: string;
  /** The parent dashboard. */
  parent_dashboard_id: string | null;
  /** The pinned version. */
  version: number;
  /** The pin time. */
  pinned_at: number;
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
    `SELECT d.id AS dashboard_id, d.title, d.description, d.tags, d.parent_dashboard_id, v.version,
       v.pinned_at, v.spec
     FROM dashboards d JOIN dashboard_versions v ON v.id = d.pinned_version_id
     WHERE d.deleted_at IS NULL ORDER BY d.updated_at DESC`,
  );
  return () =>
    select.all().map((row) => ({
      dashboardId: row.dashboard_id,
      title: row.title,
      description: row.description,
      tags: JSON.parse(row.tags) as string[],
      parentDashboardId: row.parent_dashboard_id,
      version: row.version,
      pinnedAt: row.pinned_at,
      spec: JSON.parse(row.spec),
    }));
}
