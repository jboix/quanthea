/** Loads and saves the model settings, and tests the connection, through the API. */
import {
  getModelSettingsEndpoint,
  listModelsEndpoint,
  type ModelGateway,
  type ModelProvider,
  type ModelSettingsView,
  type modelTestSchema,
  saveModelSettingsEndpoint,
  testModelSettingsEndpoint,
} from '@quanthea/shared';
import type { ActionFunctionArgs } from 'react-router';
import type { z } from 'zod';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';

/** The result of a connection test. */
export type ModelTest = z.output<typeof modelTestSchema>;

/** What the settings screen submits, as JSON. */
export type ModelSettingsIntent =
  | {
      readonly intent: 'save';
      readonly gateway: ModelGateway;
      readonly apiKeys: Readonly<Record<string, string>>;
    }
  | { readonly intent: 'test'; readonly providerId: string }
  | {
      readonly intent: 'models';
      readonly provider: ModelProvider;
      readonly baseUrl: string | null;
      readonly apiKey?: string;
      readonly providerId?: string;
    };

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
  | { readonly intent: 'test'; readonly result: ModelTest }
  | {
      readonly intent: 'models';
      readonly models: readonly string[];
      readonly message: string | null;
    };

/**
 * Keys the server's validation issues by settings path.
 *
 * @param details - The `details` of the error.
 * @returns The first message of each field.
 */
function issuesOf(details: unknown): Record<string, string> {
  if (!Array.isArray(details)) return {};
  const keyed = (details as { path?: unknown; message?: unknown }[]).map((issue) => [
    String(issue.path ?? '').replace(/^gateway\./, ''),
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
 * @param body - The gateway and any new keys.
 * @returns The outcome.
 */
async function save(
  api: ApiClient,
  body: { gateway: ModelGateway; apiKeys: Readonly<Record<string, string>> },
): Promise<ModelSettingsOutcome> {
  try {
    return { intent: 'save', ok: true, view: await api.call(saveModelSettingsEndpoint, { body }) };
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'bad_request') throw error;
    return { intent: 'save', ok: false, message: error.message, issues: issuesOf(error.details) };
  }
}

/**
 * Lists a provider's models. A base URL the server refuses, such as one half typed, lists none
 * and says why.
 *
 * @param api - The API client.
 * @param body - The provider, its base URL, and a key or the saved provider's id.
 * @returns The outcome.
 */
async function listModels(
  api: ApiClient,
  body: Omit<Extract<ModelSettingsIntent, { intent: 'models' }>, 'intent'>,
): Promise<ModelSettingsOutcome> {
  try {
    return { intent: 'models', ...(await api.call(listModelsEndpoint, { body })) };
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'bad_request') throw error;
    return { intent: 'models', models: [], message: 'Enter an http or https base URL.' };
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
      const body = { providerId: intent.providerId };
      return { intent: 'test', result: await api.call(testModelSettingsEndpoint, { body }) };
    }
    if (intent.intent === 'models') {
      const { intent: _intent, ...body } = intent;
      return listModels(api, body);
    }
    return save(api, { gateway: intent.gateway, apiKeys: { ...intent.apiKeys } });
  };
}
