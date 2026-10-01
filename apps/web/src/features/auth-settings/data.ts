/** Settings → Authentication: the loader, and the action that changes the sign-in providers. */
import {
  type EndpointInput,
  enableIdentityProviderEndpoint,
  getIdentityProvidersEndpoint,
  type IdentityProvidersView,
  passwordSignInEndpoint,
  removeIdentityProviderEndpoint,
  saveIdentityProviderEndpoint,
} from '@quanthea/shared';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';

/** What the authentication screen shows: the ways to sign in. */
export interface AuthSettingsData {
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
export type AuthSettingsIntent = ProviderIntent;

/** What an intent answers: done, or why not. */
export type AuthSettingsOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/**
 * The loader of the authentication screen.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadAuthSettings(api: ApiClient) {
  return async ({ request }: LoaderFunctionArgs): Promise<AuthSettingsData> => ({
    signIn: await api.call(getIdentityProvidersEndpoint, undefined, { signal: request.signal }),
  });
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
 * The action of the authentication screen.
 *
 * @param api - The API client.
 * @returns The action. A refusal comes back as a message.
 */
export function changeAuthSettings(api: ApiClient) {
  return async ({ request }: ActionFunctionArgs): Promise<AuthSettingsOutcome> => {
    try {
      await runProvider(api, (await request.json()) as AuthSettingsIntent);
      return { ok: true };
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      return { ok: false, message: error.message };
    }
  };
}
