/** Turns stored dashboards and versions into what the API returns, by role. */
import { type DashboardDetail, hasRole, type Role } from '@quanthea/shared';
import type { DashboardRow, VersionSummaryRow } from '../db/dashboard-repository.ts';

/**
 * Whether a role may see a version: editors see every version; viewers see the versions pinned at
 * some time, while the dashboard is pinned.
 *
 * @param version - The version.
 * @param role - The role of the request.
 * @param dashboardPinned - Whether the dashboard shows a version.
 * @returns Whether it is visible.
 */
export function canSee(
  version: Pick<VersionSummaryRow, 'pinnedAt'>,
  role: Role,
  dashboardPinned: boolean,
): boolean {
  return hasRole(role, 'editor') || (dashboardPinned && version.pinnedAt !== null);
}

/**
 * The detail of a dashboard, with the versions the role may see.
 *
 * @param row - The dashboard.
 * @param versions - All its versions.
 * @param role - The role of the request.
 * @returns The detail.
 */
export function toDetail(
  row: DashboardRow,
  versions: readonly VersionSummaryRow[],
  role: Role,
): DashboardDetail {
  const pinned = versions.find((version) => version.id === row.pinnedVersionId);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    tags: [...row.tags],
    parentDashboardId: row.parentDashboardId,
    parentVersion: row.parentVersion,
    pinnedVersion: pinned?.version ?? null,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    versions: versions
      .filter((version) => canSee(version, role, row.pinnedVersionId !== null))
      .map((version) => ({
        version: version.version,
        changeSummary: version.changeSummary,
        pinnedAt: version.pinnedAt,
        actor: version.actor,
        createdAt: version.createdAt,
      })),
  };
}
