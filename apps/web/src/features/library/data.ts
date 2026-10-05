/**
 * The library's loader: the tab, the search and filters in the URL, and what the server finds. The
 * Dashboards tab searches the pinned dashboards; the Snapshots tab, at `?view=snapshots`, the live
 * snapshots.
 */
import { type LibrarySearch, searchLibraryEndpoint } from '@quanthea/shared';
import type { LoaderFunctionArgs } from 'react-router';
import type { ApiClient } from '../../lib/api-client.ts';
import { loadSnapshotList, type SnapshotsData } from './snapshot-data.ts';

/** What the Dashboards tab shows. */
export interface DashboardsData {
  /** Which tab. */
  readonly view: 'dashboards';
  /** The matching dashboards, and every tag and connector. */
  readonly search: LibrarySearch;
  /** The search words, from `?q=`. */
  readonly q: string;
  /** The tags asked for, from repeated `?tag=`. */
  readonly tags: readonly string[];
  /** The connectors asked for, from repeated `?connector=`. */
  readonly connectors: readonly string[];
}

/** What the library screen shows: one tab's data. */
export type LibraryData = DashboardsData | SnapshotsData;

/**
 * A list as the endpoint reads it.
 *
 * @param values - The values.
 * @returns The values separated by commas, or `undefined` when there are none.
 */
function listOf(values: readonly string[]): string | undefined {
  return values.length === 0 ? undefined : values.join(',');
}

/**
 * Loads the Dashboards tab for the search in the URL.
 *
 * @param api - The API client.
 * @param params - The URL's search parameters.
 * @param signal - Aborted when the navigation is.
 * @returns The tab's data.
 */
async function loadDashboards(
  api: ApiClient,
  params: URLSearchParams,
  signal: AbortSignal,
): Promise<DashboardsData> {
  const q = params.get('q')?.trim() ?? '';
  const tags = params.getAll('tag');
  const connectors = params.getAll('connector');
  const query = { q: q || undefined, tags: listOf(tags), connectors: listOf(connectors) };
  const search = await api.call(searchLibraryEndpoint, { query }, { signal });
  return { view: 'dashboards', search, q, tags, connectors };
}

/**
 * Loads the library's tab in the URL.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadLibrary(api: ApiClient) {
  return ({ request }: LoaderFunctionArgs): Promise<LibraryData> => {
    const params = new URL(request.url).searchParams;
    return params.get('view') === 'snapshots'
      ? loadSnapshotList(api, params, request.signal)
      : loadDashboards(api, params, request.signal);
  };
}
