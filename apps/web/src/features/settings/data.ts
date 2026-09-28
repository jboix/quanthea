/** Loads and saves the model settings, and tests the connection, through the API. */
import {
  getModelSettingsEndpoint,
  type ModelSettings,
  type ModelSettingsView,
  type modelTestSchema,
  saveModelSettingsEndpoint,
  testModelSettingsEndpoint,
} from '@querent/shared';
import type { ActionFunctionArgs } from 'react-router';
import type { z } from 'zod';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';

/** The result of a connection test. */
export type ModelTest = z.output<typeof modelTestSchema>;

/** What the settings screen submits, as JSON. */
export type ModelSettingsIntent =
  | { readonly intent: 'save'; readonly settings: ModelSettings; readonly apiKey?: string }
  | { readonly intent: 'test' };

/** What the action returns. */
export type ModelSettingsOutcome =
  | { readonly intent: 'save'; readonly ok: true; readonly view: ModelSettingsView }
  | {
      readonly intent: 'save';
      readonly ok: false;
      readonly message: string;
      /** Problems by field path, such as `limits.toolCallsPerTurn`. */
      readonly issues: Readonly<Record<string, string>>;
    }
  | { readonly intent: 'test'; readonly result: ModelTest };

/**
 * Keys the server's validation issues by settings path.
 *
 * @param details - The `details` of the error.
 * @returns The first message of each field.
 */
function issuesOf(details: unknown): Record<string, string> {
  if (!Array.isArray(details)) return {};
  const keyed = (details as { path?: unknown; message?: unknown }[]).map((issue) => [
    String(issue.path ?? '').replace(/^settings\./, ''),
    String(issue.message ?? ''),
  ]);
  return Object.fromEntries(keyed.reverse());
}

/**
 * The loader of the model settings screen.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadModelSettings(api: ApiClient) {
  return (): Promise<ModelSettingsView> => api.call(getModelSettingsEndpoint);
}

/**
 * Saves the settings, keeping refusals the admin can fix as an outcome.
 *
 * @param api - The API client.
 * @param body - The settings and, if given, a new key.
 * @returns The outcome.
 */
async function save(
  api: ApiClient,
  body: { settings: ModelSettings; apiKey?: string },
): Promise<ModelSettingsOutcome> {
  try {
    return { intent: 'save', ok: true, view: await api.call(saveModelSettingsEndpoint, { body }) };
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'bad_request') throw error;
    return { intent: 'save', ok: false, message: error.message, issues: issuesOf(error.details) };
  }
}

/**
 * The action of the model settings screen: save, or test the saved settings.
 *
 * @param api - The API client.
 * @returns The action.
 */
export function modelSettingsAction(api: ApiClient) {
  return async ({ request }: ActionFunctionArgs): Promise<ModelSettingsOutcome> => {
    const intent = (await request.json()) as ModelSettingsIntent;
    if (intent.intent === 'test') {
      return { intent: 'test', result: await api.call(testModelSettingsEndpoint) };
    }
    const { settings, apiKey } = intent;
    return save(api, apiKey === undefined ? { settings } : { settings, apiKey });
  };
}
