/**
 * Layouts from the dashboard screen: save the version shown as arranged by hand, or restore an
 * earlier arrangement. A layout changes how the version is shown, never the version.
 */
import {
  type DashboardLayout,
  type LayoutRevision,
  listDashboardLayoutsEndpoint,
  restoreDashboardLayoutEndpoint,
  saveDashboardLayoutEndpoint,
} from '@quanthea/shared';
import type { LoaderFunctionArgs } from 'react-router';
import type { ApiClient } from '../../lib/api-client.ts';
import { type Loaded, loaded } from './loaded.ts';

/** What the dashboard screen submits about layouts, as JSON. */
export type LayoutIntent =
  | {
      readonly intent: 'layout';
      readonly version: number;
      readonly layout: DashboardLayout;
      readonly basedOn: number | null;
    }
  | {
      readonly intent: 'restoreLayout';
      readonly version: number;
      readonly revision: number;
      readonly basedOn: number | null;
    };

/**
 * Saves a layout, or restores an earlier one.
 *
 * @param api - The API client.
 * @param dashboardId - The dashboard.
 * @param intent - What to do.
 * @returns The new revision, or why it was refused, such as someone saving meanwhile.
 */
export function runLayoutIntent(
  api: ApiClient,
  dashboardId: string,
  intent: LayoutIntent,
): Promise<Loaded<LayoutRevision>> {
  const version = String(intent.version);
  if (intent.intent === 'restoreLayout') {
    const params = { dashboardId, version, revision: String(intent.revision) };
    const body = { basedOn: intent.basedOn };
    return loaded(api.call(restoreDashboardLayoutEndpoint, { params, body }));
  }
  const body = { layout: intent.layout, basedOn: intent.basedOn };
  return loaded(api.call(saveDashboardLayoutEndpoint, { params: { dashboardId, version }, body }));
}

/**
 * The loader of a version's layout history resource route, for the edit bar's History.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadLayoutHistory(api: ApiClient) {
  return ({ params, request }: LoaderFunctionArgs): Promise<Loaded<LayoutRevision[]>> => {
    const input = {
      params: { dashboardId: params.dashboardId ?? '', version: params.version ?? '' },
    };
    const call = api.call(listDashboardLayoutsEndpoint, input, { signal: request.signal });
    return loaded(call.then((result) => result.revisions));
  };
}
