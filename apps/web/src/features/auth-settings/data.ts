/**
 * Settings → Authentication: the loader, and the action that switches the mode, adopts threads,
 * and changes the sign-in providers.
 */
import {
  type AuthMode,
  type AuthSettingsView,
  adoptThreadsEndpoint,
  type EndpointInput,
  enableIdentityProviderEndpoint,
  getAuthSettingsEndpoint,
  getIdentityProvidersEndpoint,
  type IdentityProvidersView,
  passwordSignInEndpoint,
  removeIdentityProviderEndpoint,
  saveAuthSettingsEndpoint,
  saveIdentityProviderEndpoint,
} from '@querent/shared';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';

/** What the authentication screen shows: the mode, and the ways to sign in. */
export interface AuthSettingsData {
  /** The mode and what accounts still need. */
  readonly auth: AuthSettingsView;
  /** The sign-in providers, and whether passwords sign in. */
  readonly signIn: IdentityProvidersView;
}

/** A provider as the form sends it. */
export type ProviderBody = EndpointInput<typeof saveIdentityProviderEndpoint>['body'];

/** What the provider cards submit, as JSON. */
export type ProviderIntent =
  | { readonly intent: 'save-provider'; readonly providerId: string; readonly body: ProviderBody }
  | { readonly intent: 'enable-provider'; readonly providerId: string; readonly enabled: boolean }
  | { readonly intent: 'remove-provider'; readonly providerId: string }
  | { readonly intent: 'password-sign-in'; readonly enabled: boolean };

/** What the authentication screen submits, as JSON. */
export type AuthSettingsIntent =
  | { readonly intent: 'switch'; readonly mode: AuthMode; readonly adoptTo?: string }
  | { readonly intent: 'adopt'; readonly userId: string }
  | ProviderIntent;

/** What an intent answers: the mode now, after a switch or an adoption, or why not. */
export type AuthSettingsOutcome =
  | { readonly ok: true; readonly mode?: AuthMode }
  | { readonly ok: false; readonly message: string };

/**
 * The loader of the authentication screen.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadAuthSettings(api: ApiClient) {
  return async ({ request }: LoaderFunctionArgs): Promise<AuthSettingsData> => {
    const options = { signal: request.signal };
    const [auth, signIn] = await Promise.all([
      api.call(getAuthSettingsEndpoint, undefined, options),
      api.call(getIdentityProvidersEndpoint, undefined, options),
    ]);
    return { auth, signIn };
  };
}

/**
 * Runs one provider intent.
 *
 * @param api - The API client.
 * @param intent - The intent.
 * @returns Once it is done.
 */
async function runProvider(api: ApiClient, intent: ProviderIntent): Promise<void> {
  if (intent.intent === 'password-sign-in') {
    await api.call(passwordSignInEndpoint, { body: { enabled: intent.enabled } });
    return;
  }
  const params = { providerId: intent.providerId };
  if (intent.intent === 'save-provider')
    await api.call(saveIdentityProviderEndpoint, { params, body: intent.body });
  else if (intent.intent === 'enable-provider')
    await api.call(enableIdentityProviderEndpoint, { params, body: { enabled: intent.enabled } });
  else await api.call(removeIdentityProviderEndpoint, { params });
}

/**
 * Runs one intent.
 *
 * @param api - The API client.
 * @param intent - The intent.
 * @returns The outcome: the mode in force after a switch or an adoption.
 */
async function run(api: ApiClient, intent: AuthSettingsIntent): Promise<AuthSettingsOutcome> {
  if (intent.intent === 'adopt') {
    await api.call(adoptThreadsEndpoint, { body: { userId: intent.userId } });
    return { ok: true, mode: 'accounts' };
  }
  if (intent.intent === 'switch') {
    const body = { mode: intent.mode, ...(intent.adoptTo ? { adoptTo: intent.adoptTo } : {}) };
    return { ok: true, mode: (await api.call(saveAuthSettingsEndpoint, { body })).mode };
  }
  await runProvider(api, intent);
  return { ok: true };
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
      return await run(api, (await request.json()) as AuthSettingsIntent);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      return { ok: false, message: error.message };
    }
  };
}
