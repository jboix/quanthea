/**
 * Snapshots: the loader of a snapshot's page, which runs no query, and Settings → Snapshots, where
 * admins see every live snapshot and revoke one.
 */
import {
  getSnapshotEndpoint,
  listSnapshotsEndpoint,
  revokeSnapshotEndpoint,
  type Snapshot,
  type SnapshotSummary,
} from '@quanthea/shared';
import { type ActionFunctionArgs, data, type LoaderFunctionArgs } from 'react-router';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';

/** What Settings → Snapshots submits, as JSON. */
export interface RevokeIntent {
  /** The snapshot to revoke. */
  readonly snapshotId: string;
}

/** The outcome of a revoke: done, or why not. */
export type RevokeOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/**
 * The loader of a snapshot's page. An unknown, revoked or expired snapshot is a 404.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadSnapshot(api: ApiClient) {
  return async ({ params, request }: LoaderFunctionArgs): Promise<Snapshot> => {
    const input = { params: { snapshotId: params.snapshotId ?? '' } };
    try {
      return await api.call(getSnapshotEndpoint, input, { signal: request.signal });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'not_found')
        throw data(null, { status: 404, statusText: 'Not Found' });
      throw error;
    }
  };
}

/**
 * The loader of Settings → Snapshots.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadSnapshots(api: ApiClient) {
  return async ({ request }: LoaderFunctionArgs): Promise<readonly SnapshotSummary[]> =>
    (await api.call(listSnapshotsEndpoint, undefined, { signal: request.signal })).snapshots;
}

/**
 * The action of Settings → Snapshots: revoke one.
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
