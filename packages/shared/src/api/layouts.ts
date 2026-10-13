/**
 * Layout endpoints: the history of a version's layout, saving a new revision, and restoring an
 * earlier one. Dashboards and reports have the same three, under their own paths. A layout only
 * changes how a version is shown, never the version.
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

/** The path parameters of one version of what is arranged: `id` is the dashboard or the report. */
const versionParams = z.object({
  id: z.string().min(1).max(64),
  version: z.string().regex(/^[1-9]\d{0,5}$/),
});

/**
 * Declares the layout endpoints of one kind of thing that has versions with panels.
 *
 * @param collection - Its collection in the API, such as `dashboards`.
 * @returns The endpoints: `list` the revisions of a version's layout, latest first; `save` a
 *   layout of the version shown as a new revision, where `basedOn` is the revision the change
 *   started from, or `null` for the spec's own, and a change based on an older one is refused;
 *   `restore` an earlier revision, by adding a revision that copies it. All three are for those
 *   who may change it: its thread's owner and admins.
 */
function defineLayoutEndpoints(collection: 'dashboards' | 'reports') {
  const path = `/${collection}/:id/versions/:version/layouts` as const;
  const basedOn = z.int().min(1).nullable();
  return {
    list: defineEndpoint({
      method: 'GET',
      path,
      params: versionParams,
      output: z.object({ revisions: z.array(layoutRevisionSchema) }),
    }),
    save: defineEndpoint({
      method: 'POST',
      path,
      params: versionParams,
      body: z.object({ layout: dashboardLayoutSchema, basedOn }),
      output: layoutRevisionSchema,
    }),
    restore: defineEndpoint({
      method: 'POST',
      path: `${path}/:revision/restore`,
      params: versionParams.extend({ revision: z.string().regex(/^[1-9]\d{0,5}$/) }),
      body: z.object({ basedOn }),
      output: layoutRevisionSchema,
    }),
  };
}

/** The layout endpoints of one kind of thing. */
export type LayoutEndpoints = ReturnType<typeof defineLayoutEndpoints>;

/** The layout endpoints of dashboards: only the version shown in the library is arranged. */
export const dashboardLayoutEndpoints = defineLayoutEndpoints('dashboards');

/** The layout endpoints of reports: only the active version is arranged. */
export const reportLayoutEndpoints = defineLayoutEndpoints('reports');
