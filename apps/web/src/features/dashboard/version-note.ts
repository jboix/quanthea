/** How a version is named in a history list. */
import type { DashboardDetail } from '@quanthea/shared';

/**
 * What a version is: the one the library shows, one pinned before, or a draft with its summary.
 *
 * @param version - The version.
 * @param pinnedVersion - The version the library shows, if any.
 * @returns Such as `pinned`, `pinned before` or `Added a latency panel`.
 */
export function versionNote(
  version: DashboardDetail['versions'][number],
  pinnedVersion: number | null,
): string {
  if (version.version === pinnedVersion) return 'pinned';
  if (version.pinnedAt !== null) return 'pinned before';
  return version.changeSummary ?? 'draft';
}
