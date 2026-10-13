/**
 * Layouts from the screen of a dashboard or of a report's run: save the version shown as arranged
 * by hand, or restore an earlier arrangement. A layout changes how the version is shown, never the
 * version.
 */
import type { DashboardLayout, LayoutEndpoints, LayoutRevision } from '@quanthea/shared';
import type { LoaderFunctionArgs } from 'react-router';
import type { ApiClient } from '../../lib/api-client.ts';
import { type Loaded, loaded } from './loaded.ts';

/** What a screen submits about layouts, as JSON. */
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
 * Whether an intent is about a layout.
 *
 * @param intent - Any intent a screen submits.
 * @returns Whether it saves or restores a layout.
 */
export function isLayoutIntent(intent: { readonly intent: string }): intent is LayoutIntent {
  return intent.intent === 'layout' || intent.intent === 'restoreLayout';
}

/**
 * Saves a layout, or restores an earlier one.
 *
 * @param api - The API client.
 * @param endpoints - The layout endpoints of dashboards, or of reports.
 * @param id - The dashboard or the report.
 * @param intent - What to do.
 * @returns The new revision, or why it was refused, such as someone saving meanwhile.
 */
export function runLayoutIntent(
  api: ApiClient,
  endpoints: LayoutEndpoints,
  id: string,
  intent: LayoutIntent,
): Promise<Loaded<LayoutRevision>> {
  const version = String(intent.version);
  if (intent.intent === 'restoreLayout') {
    const params = { id, version, revision: String(intent.revision) };
    const body = { basedOn: intent.basedOn };
    return loaded(api.call(endpoints.restore, { params, body }));
  }
  const body = { layout: intent.layout, basedOn: intent.basedOn };
  return loaded(api.call(endpoints.save, { params: { id, version }, body }));
}

/**
 * The loader of a version's layout history resource route, for the edit bar's History.
 *
 * @param api - The API client.
 * @param endpoints - The layout endpoints of dashboards, or of reports.
 * @param idParam - The route parameter that names the dashboard or the report.
 * @returns The loader.
 */
export function loadLayoutHistory(
  api: ApiClient,
  endpoints: LayoutEndpoints,
  idParam: 'dashboardId' | 'reportId',
) {
  return ({ params, request }: LoaderFunctionArgs): Promise<Loaded<LayoutRevision[]>> => {
    const input = { params: { id: params[idParam] ?? '', version: params.version ?? '' } };
    const call = api.call(endpoints.list, input, { signal: request.signal });
    return loaded(call.then((result) => result.revisions));
  };
}
