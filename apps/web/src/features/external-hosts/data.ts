/** Loads and saves the external hosts: where dashboards may link and load images from. */
import {
  type ExternalHosts,
  getExternalHostsEndpoint,
  saveExternalHostsEndpoint,
} from '@quanthea/shared';
import type { ActionFunctionArgs } from 'react-router';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';

/** What saving returns. */
export type HostsOutcome =
  | { readonly ok: true; readonly settings: ExternalHosts }
  | { readonly ok: false; readonly message: string };

/**
 * The loader of the external hosts screen.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadExternalHosts(api: ApiClient) {
  return (): Promise<ExternalHosts> => api.call(getExternalHostsEndpoint);
}

/**
 * The action of the external hosts screen: saves them, keeping a refusal as an outcome.
 *
 * @param api - The API client.
 * @returns The action.
 */
export function externalHostsAction(api: ApiClient) {
  return async ({ request }: ActionFunctionArgs): Promise<HostsOutcome> => {
    const settings = (await request.json()) as ExternalHosts;
    try {
      return { ok: true, settings: await api.call(saveExternalHostsEndpoint, { body: settings }) };
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'bad_request') throw error;
      return { ok: false, message: error.message };
    }
  };
}
