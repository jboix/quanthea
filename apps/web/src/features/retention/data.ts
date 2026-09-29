/** Loads and saves the retention settings: how long deleted threads stay in the bin. */
import {
  getRetentionSettingsEndpoint,
  type RetentionSettings,
  saveRetentionSettingsEndpoint,
} from '@querent/shared';
import type { ActionFunctionArgs } from 'react-router';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';

/** What saving returns. */
export type RetentionOutcome =
  | { readonly ok: true; readonly settings: RetentionSettings }
  | { readonly ok: false; readonly message: string };

/**
 * The loader of the retention screen.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadRetention(api: ApiClient) {
  return (): Promise<RetentionSettings> => api.call(getRetentionSettingsEndpoint);
}

/**
 * The action of the retention screen: saves the settings, keeping a refusal as an outcome.
 *
 * @param api - The API client.
 * @returns The action.
 */
export function retentionAction(api: ApiClient) {
  return async ({ request }: ActionFunctionArgs): Promise<RetentionOutcome> => {
    const settings = (await request.json()) as RetentionSettings;
    try {
      return {
        ok: true,
        settings: await api.call(saveRetentionSettingsEndpoint, { body: settings }),
      };
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'bad_request') throw error;
      return { ok: false, message: error.message };
    }
  };
}
