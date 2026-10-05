/** The loader of a snapshot's page, which runs no query. */
import { getSnapshotEndpoint, type Snapshot } from '@quanthea/shared';
import { data, type LoaderFunctionArgs } from 'react-router';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';

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
