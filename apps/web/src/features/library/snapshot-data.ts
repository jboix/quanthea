/**
 * The Library's Snapshots tab: the live snapshots the person may see, searched on the server, and
 * revoking one, for editors.
 */
import {
  revokeSnapshotEndpoint,
  type SnapshotFilter,
  type SnapshotSummary,
  searchSnapshotsEndpoint,
  snapshotFilters,
} from '@quanthea/shared';
import type { ActionFunctionArgs } from 'react-router';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';

/** How many snapshots a page shows at first, and how many more each "Show more" adds. */
export const snapshotPageSize = 50;

/** What the Snapshots tab shows. */
export interface SnapshotsData {
  /** Which tab. */
  readonly view: 'snapshots';
  /** The snapshots shown, the newest first. */
  readonly snapshots: readonly SnapshotSummary[];
  /** How many match, over every page. */
  readonly total: number;
  /** The search words, from `?q=`. */
  readonly q: string;
  /** The filter, from `?filter=`. */
  readonly filter: SnapshotFilter;
  /** How many to show, from `?limit=`. */
  readonly limit: number;
}

/** What the Snapshots tab submits, as JSON. */
export interface RevokeIntent {
  /** The snapshot to revoke. */
  readonly snapshotId: string;
}

/** The outcome of a revoke: done, or why not. */
export type RevokeOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/**
 * The filter in the URL.
 *
 * @param value - The `filter` parameter.
 * @returns The filter, `all` for anything unknown.
 */
function filterOf(value: string | null): SnapshotFilter {
  return snapshotFilters.find((filter) => filter === value) ?? 'all';
}

/**
 * How many snapshots to show, from the URL: a whole number of pages, at most 200.
 *
 * @param value - The `limit` parameter.
 * @returns The number.
 */
function limitOf(value: string | null): number {
  const asked = Math.ceil(Number(value ?? snapshotPageSize) / snapshotPageSize) * snapshotPageSize;
  return Number.isFinite(asked)
    ? Math.min(Math.max(asked, snapshotPageSize), 200)
    : snapshotPageSize;
}

/**
 * Loads the Snapshots tab for the search in the URL. The period is searched as the browser writes
 * it, in its time zone.
 *
 * @param api - The API client.
 * @param params - The URL's search parameters.
 * @param signal - Aborted when the navigation is.
 * @returns The tab's data.
 */
export async function loadSnapshotList(
  api: ApiClient,
  params: URLSearchParams,
  signal: AbortSignal,
): Promise<SnapshotsData> {
  const q = params.get('q')?.trim() ?? '';
  const filter = filterOf(params.get('filter'));
  const limit = limitOf(params.get('limit'));
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const query = { q: q || undefined, filter, timeZone, offset: 0, limit };
  const found = await api.call(searchSnapshotsEndpoint, { query }, { signal });
  return { view: 'snapshots', ...found, q, filter, limit };
}

/**
 * The Library's action: revoke a snapshot.
 *
 * @param api - The API client.
 * @returns The action. A refusal comes back as a message.
 */
export function revokeSnapshot(api: ApiClient) {
  return async ({ request }: ActionFunctionArgs): Promise<RevokeOutcome> => {
    const { snapshotId } = (await request.json()) as RevokeIntent;
    try {
      await api.call(revokeSnapshotEndpoint, { params: { snapshotId } });
      return { ok: true };
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      return { ok: false, message: error.message };
    }
  };
}
