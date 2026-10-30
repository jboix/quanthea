/**
 * Where a model provider's requests go, and whether a stored key may follow a provider whose
 * settings changed: a key only goes to the vendor and base URL it was saved for, and a client
 * secret only to the identity provider and client it was saved for.
 */
import { type ModelProvider, type ProviderAuth, providerProfiles } from '@quanthea/shared';

/** A provider, as a listing names it or as it is saved. */
export interface ProviderTarget {
  /** The saved provider's id, if any. */
  readonly providerId?: string | undefined;
  /** The vendor kind. */
  readonly provider: ModelProvider;
  /** The base URL, or `null` for the provider's own API. */
  readonly baseUrl: string | null;
  /** How the provider is reached; absent means with an API key. */
  readonly auth?: ProviderAuth | undefined;
}

/**
 * Where a provider's stored secret goes: nowhere but the model for an API key, or the identity
 * provider and the client it names.
 *
 * @param target - The provider.
 * @returns The destination, in one spelling.
 */
function secretDestinationOf(target: ProviderTarget): string {
  const { auth } = target;
  if (auth?.type !== 'oauth-client-credentials') return 'api-key';
  return JSON.stringify([auth.issuer, auth.tokenUrl, auth.clientId]);
}

/**
 * The base URL a provider's requests go to, in one spelling: parsed, without a trailing slash.
 *
 * @param target - The provider and its base URL.
 * @returns The URL, or `null` when there is none or it does not parse.
 */
function destinationOf(target: ProviderTarget): string | null {
  const base = target.baseUrl ?? providerProfiles[target.provider].baseUrl;
  if (base === null || !URL.canParse(base)) return null;
  return new URL(base).href.replace(/\/+$/, '');
}

/**
 * Whether a saved provider's key may go with a listing: only to the same provider, the same
 * vendor and the same base URL, and a client secret only to the same identity provider and client.
 *
 * @param request - The provider the listing names.
 * @param saved - The saved provider.
 * @returns `true` when the stored key may be sent.
 */
export function storedKeyApplies(request: ProviderTarget, saved: ProviderTarget): boolean {
  if (request.providerId === undefined || request.providerId !== saved.providerId) return false;
  if (request.provider !== saved.provider) return false;
  if (secretDestinationOf(request) !== secretDestinationOf(saved)) return false;
  const destination = destinationOf(request);
  return destination !== null && destination === destinationOf(saved);
}
