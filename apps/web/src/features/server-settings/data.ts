/** Loads the system settings. */
import { getServerSettingsEndpoint, type ServerSettingsView } from '@quanthea/shared';
import type { LoaderFunctionArgs } from 'react-router';
import type { ApiClient } from '../../lib/api-client.ts';

/**
 * The loader of the server screen.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadServerSettings(api: ApiClient) {
  return ({ request }: LoaderFunctionArgs): Promise<ServerSettingsView> =>
    api.call(getServerSettingsEndpoint, undefined, { signal: request.signal });
}
