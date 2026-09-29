/** Settings → Authentication: the loader, and the action that switches the mode or adopts threads. */
import {
  type AuthMode,
  type AuthSettingsView,
  adoptThreadsEndpoint,
  getAuthSettingsEndpoint,
  saveAuthSettingsEndpoint,
} from '@querent/shared';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';

/** What the authentication screen submits, as JSON. */
export type AuthSettingsIntent =
  | { readonly intent: 'switch'; readonly mode: AuthMode; readonly adoptTo?: string }
  | { readonly intent: 'adopt'; readonly userId: string };

/** What an intent answers: the mode now, or why not. */
export type AuthSettingsOutcome =
  | { readonly ok: true; readonly mode: AuthMode }
  | { readonly ok: false; readonly message: string };

/**
 * The loader of the authentication screen.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadAuthSettings(api: ApiClient) {
  return ({ request }: LoaderFunctionArgs): Promise<AuthSettingsView> =>
    api.call(getAuthSettingsEndpoint, undefined, { signal: request.signal });
}

/**
 * Runs one intent.
 *
 * @param api - The API client.
 * @param intent - The intent.
 * @returns The mode in force afterwards.
 */
async function run(api: ApiClient, intent: AuthSettingsIntent): Promise<AuthMode> {
  if (intent.intent === 'adopt') {
    await api.call(adoptThreadsEndpoint, { body: { userId: intent.userId } });
    return 'accounts';
  }
  const body = { mode: intent.mode, ...(intent.adoptTo ? { adoptTo: intent.adoptTo } : {}) };
  return (await api.call(saveAuthSettingsEndpoint, { body })).mode;
}

/**
 * The action of the authentication screen.
 *
 * @param api - The API client.
 * @returns The action. A refusal comes back as a message.
 */
export function changeAuthSettings(api: ApiClient) {
  return async ({ request }: ActionFunctionArgs): Promise<AuthSettingsOutcome> => {
    try {
      return { ok: true, mode: await run(api, (await request.json()) as AuthSettingsIntent) };
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      return { ok: false, message: error.message };
    }
  };
}
