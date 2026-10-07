/**
 * Dashboard layout endpoints: the history of a version's layout, saving a new revision, and
 * restoring an earlier one. A layout only changes how a version is shown, never the version.
 */
import { z } from 'zod';
import { dashboardLayoutSchema } from '../spec/layout.ts';
import { defineEndpoint } from './contract.ts';

/** Validates the layout a version is shown with: its latest revision. */
export const shownLayoutSchema = z.object({
  revision: z.int().min(1),
  layout: dashboardLayoutSchema,
});

/** The layout a version is shown with. */
export type ShownLayout = z.infer<typeof shownLayoutSchema>;

/** Validates one revision in a layout's history. */
export const layoutRevisionSchema = shownLayoutSchema.extend({
  /** The revision it copies, when it restores one. */
  restoredFrom: z.int().nullable(),
  /** The name of the person who saved it. */
  savedBy: z.string(),
  createdAt: z.number(),
});

/** One revision in a layout's history. */
export type LayoutRevision = z.infer<typeof layoutRevisionSchema>;

/** The path parameters of one version of a dashboard. */
const versionParams = z.object({
  dashboardId: z.string().min(1),
  version: z.string().regex(/^[1-9]\d{0,5}$/),
});

/**
 * Lists the revisions of a version's layout, latest first. For those who may change the
 * dashboard: its thread's owner and admins.
 */
export const listDashboardLayoutsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/dashboards/:dashboardId/versions/:version/layouts',
  params: versionParams,
  output: z.object({ revisions: z.array(layoutRevisionSchema) }),
});

/**
 * Saves a layout of the version shown as a new revision. `basedOn` is the revision the change
 * started from, or `null` for the spec's own; a change based on an older one is refused.
 */
export const saveDashboardLayoutEndpoint = defineEndpoint({
  method: 'POST',
  path: '/dashboards/:dashboardId/versions/:version/layouts',
  params: versionParams,
  body: z.object({ layout: dashboardLayoutSchema, basedOn: z.int().min(1).nullable() }),
  output: layoutRevisionSchema,
});

/** Restores an earlier revision of the version shown, by adding a revision that copies it. */
export const restoreDashboardLayoutEndpoint = defineEndpoint({
  method: 'POST',
  path: '/dashboards/:dashboardId/versions/:version/layouts/:revision/restore',
  params: versionParams.extend({ revision: z.string().regex(/^[1-9]\d{0,5}$/) }),
  body: z.object({ basedOn: z.int().min(1).nullable() }),
  output: layoutRevisionSchema,
});
