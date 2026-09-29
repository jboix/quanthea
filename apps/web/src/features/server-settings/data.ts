/** Loads the system settings, and exports the configuration as a file. */
import {
  type EndpointOutput,
  exportConfigurationEndpoint,
  getServerSettingsEndpoint,
  type ServerSettingsView,
} from '@querent/shared';
import type { LoaderFunctionArgs } from 'react-router';
import type { ApiClient } from '../../lib/api-client.ts';

/** The configuration as a file. */
export type ExportedConfiguration = EndpointOutput<typeof exportConfigurationEndpoint>;

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

/**
 * The action of the server screen: exports the configuration.
 *
 * @param api - The API client.
 * @returns The action.
 */
export function exportAction(api: ApiClient) {
  return (): Promise<ExportedConfiguration> => api.call(exportConfigurationEndpoint);
}
