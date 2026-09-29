/** The library's loader: the search and filters in the URL, and what the server finds. */
import { type LibrarySearch, searchLibraryEndpoint } from '@querent/shared';
import type { LoaderFunctionArgs } from 'react-router';
import type { ApiClient } from '../../lib/api-client.ts';

/** What the library screen shows. */
export interface LibraryData {
  /** The matching dashboards, and every tag and connector. */
  readonly search: LibrarySearch;
  /** The search words, from `?q=`. */
  readonly q: string;
  /** The tags asked for, from repeated `?tag=`. */
  readonly tags: readonly string[];
  /** The connectors asked for, from repeated `?connector=`. */
  readonly connectors: readonly string[];
}

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
 * Loads the library for the search in the URL.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadLibrary(api: ApiClient) {
  return async ({ request }: LoaderFunctionArgs): Promise<LibraryData> => {
    const params = new URL(request.url).searchParams;
    const q = params.get('q')?.trim() ?? '';
    const tags = params.getAll('tag');
    const connectors = params.getAll('connector');
    const query = { q: q || undefined, tags: listOf(tags), connectors: listOf(connectors) };
    const search = await api.call(searchLibraryEndpoint, { query }, { signal: request.signal });
    return { search, q, tags, connectors };
  };
}
