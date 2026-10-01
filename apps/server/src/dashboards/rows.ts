/** The rows of a new dashboard, as created or as copied from another. */
import type { DashboardSpec } from '@quanthea/shared';
import { newId } from '../lib/ids.ts';

/**
 * The rows of a new dashboard and its first version.
 *
 * @param spec - The valid spec.
 * @param changeSummary - What this version is.
 * @param actor - Who creates it.
 * @param at - When.
 * @param parent - The dashboard and version it is copied from, if it is a copy.
 * @returns The dashboard and version rows.
 */
export function newRows(
  spec: DashboardSpec,
  changeSummary: string | undefined,
  actor: string,
  at: number,
  parent: { readonly dashboardId: string; readonly version: number } | null = null,
) {
  const id = newId();
  const dashboard = {
    id,
    title: spec.title,
    description: spec.description ?? null,
    tags: [],
    parentDashboardId: parent?.dashboardId ?? null,
    parentVersion: parent?.version ?? null,
    pinnedVersionId: null,
    deletedAt: null,
    createdAt: at,
    updatedAt: at,
  };
  const version = {
    id: newId(),
    dashboardId: id,
    version: 1,
    spec,
    changeSummary: changeSummary ?? null,
    pinnedAt: null,
    actor,
    createdAt: at,
  };
  return { dashboard, version };
}
