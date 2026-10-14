/** Pins a dashboard's version, and writes the description and tags of the version pinned. */
import type { Database } from 'bun:sqlite';
import { dashboardThreadsBinned, dashboardThreadsBinnedCheck } from './thread-guards.ts';

/** What pinning did. */
export type PinOutcome = 'pinned' | 'binned' | 'missing';

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

/** What the metadata model writes for a pinned version. */
export interface PinMetadata {
  /** One line about the dashboard. */
  readonly description: string;
  /** The tags to search by. */
  readonly tags: readonly string[];
}

/**
 * Builds the transaction that pins a version.
 *
 * @param database - A database the migrations have run on.
 * @returns The pin method.
 */
export function pinner(database: Database): (dashboardId: string, change: PinChange) => PinOutcome {
  const pinDashboard = database.query(
    `UPDATE dashboards SET pinned_version_id = ?1, title = ?2, description = ?3, tags = ?4,
       updated_at = ?5 WHERE id = ?6
       AND EXISTS (SELECT 1 FROM dashboard_versions WHERE id = ?1 AND dashboard_id = ?6)
       AND NOT (${dashboardThreadsBinned('?6')})`,
  );
  const pinVersion = database.query(
    'UPDATE dashboard_versions SET pinned_at = ? WHERE id = ? AND dashboard_id = ? AND pinned_at IS NULL',
  );
  const threadsBinned = dashboardThreadsBinnedCheck(database);
  return database.transaction((dashboardId: string, change: PinChange): PinOutcome => {
    const { versionId, title, description, tags, at } = change;
    const shown = pinDashboard.run(
      versionId,
      title,
      description,
      JSON.stringify(tags),
      at,
      dashboardId,
    );
    if (shown.changes === 0) return threadsBinned(dashboardId) ? 'binned' : 'missing';
    // A version pinned before keeps its first pin time.
    pinVersion.run(at, versionId, dashboardId);
    return 'pinned';
  });
}

/**
 * Builds the method that writes a pinned version's description and tags.
 *
 * @param database - A database the migrations have run on.
 * @returns The describe method.
 */
export function pinDescriber(
  database: Database,
): (dashboardId: string, versionId: string, metadata: PinMetadata) => boolean {
  const describe = database.query(
    `UPDATE dashboards SET description = coalesce(description, ?1), tags = ?2
       WHERE id = ?3 AND pinned_version_id = ?4`,
  );
  return (dashboardId: string, versionId: string, metadata: PinMetadata): boolean => {
    const tags = JSON.stringify(metadata.tags);
    return describe.run(metadata.description, tags, dashboardId, versionId).changes > 0;
  };
}
