/** Loads and saves the chart settings: which chart recipes the agent is offered. */
import {
  type ChartSettings,
  getChartSettingsEndpoint,
  saveChartSettingsEndpoint,
} from '@querent/shared';
import type { ActionFunctionArgs } from 'react-router';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';

/** What saving returns. */
export type ChartsOutcome =
  | { readonly ok: true; readonly settings: ChartSettings }
  | { readonly ok: false; readonly message: string };

/**
 * The loader of the chart gallery.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadChartSettings(api: ApiClient) {
  return (): Promise<ChartSettings> => api.call(getChartSettingsEndpoint);
}

/**
 * The action of the chart gallery: saves the settings, keeping a refusal as an outcome.
 *
 * @param api - The API client.
 * @returns The action.
 */
export function chartSettingsAction(api: ApiClient) {
  return async ({ request }: ActionFunctionArgs): Promise<ChartsOutcome> => {
    const settings = (await request.json()) as ChartSettings;
    try {
      return { ok: true, settings: await api.call(saveChartSettingsEndpoint, { body: settings }) };
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'bad_request') throw error;
      return { ok: false, message: error.message };
    }
  };
}
