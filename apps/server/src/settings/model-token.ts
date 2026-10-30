/**
 * Short-lived tokens for model providers reached through an identity provider, with OAuth client
 * credentials, through `openid-client` as sign-in uses it. A token stays in memory and is renewed a minute before it expires, with one request
 * in flight per provider. The client secret goes to the token URL only, never to the model.
 */
import type { ProviderAuth } from '@quanthea/shared';
import * as client from 'openid-client';
import { gatewayFetch } from './gateway-fetch.ts';

/** The identity provider settings of a provider, with its opened client secret. */
export type ClientCredentials = Extract<ProviderAuth, { type: 'oauth-client-credentials' }> & {
  /** The client secret. */
  readonly clientSecret: string;
};

/** A token as the identity provider issued it. */
export interface IssuedToken {
  /** The access token, sent to the model as a bearer token. */
  readonly accessToken: string;
  /** When it expires, in milliseconds since the epoch. */
  readonly expiresAt: number;
  /** The host of the token URL, such as `login.microsoftonline.com`. */
  readonly issuerHost: string;
}

/** Why no token could be had, in words an admin can act on. Never holds the secret. */
export class TokenError extends Error {
  /**
   * Creates the error.
   *
   * @param message - What went wrong.
   */
  constructor(message: string) {
    super(message);
    this.name = 'TokenError';
  }
}

/** Gives the tokens of providers reached through an identity provider. */
export interface TokenSource {
  /**
   * A token that is still valid for a minute or more: the cached one, or a new one.
   *
   * @param credentials - The identity provider settings and the client secret.
   * @returns The token.
   * @throws {TokenError} When the identity provider cannot be reached or refuses the client.
   */
  token(credentials: ClientCredentials): Promise<IssuedToken>;
  /**
   * Drops the cached token, so the next call asks for a new one, as after a 401.
   *
   * @param credentials - The identity provider settings and the client secret.
   */
  forget(credentials: ClientCredentials): void;
}

/** How long before it expires a token is renewed, at most. */
const renewBeforeMs = 60_000;

/** The lifetime of a token whose answer gives none. */
const defaultLifetimeSeconds = 300;

/**
 * The cache key of a set of credentials. The secret is hashed in, so a new secret gets a new token.
 *
 * @param credentials - The credentials.
 * @returns The key.
 */
function cacheKey(credentials: ClientCredentials): string {
  const { issuer, tokenUrl, clientId, clientSecret, scope, audience } = credentials;
  return String(
    Bun.hash(JSON.stringify([issuer, tokenUrl, clientId, clientSecret, scope, audience])),
  );
}

/**
 * The fetch `openid-client` is given: the gateway fetch, with its outbound checks.
 *
 * @param send - Sends the requests.
 * @returns The fetch, in the shape `openid-client` takes.
 */
function customFetchOf(send: typeof gatewayFetch): client.CustomFetch {
  return (url, options) => send(url, options as RequestInit);
}

/** How long one request to the identity provider may take, in seconds. */
const timeoutSeconds = 15;

/**
 * Whether the client goes in an HTTP Basic header: unless the issuer lists only
 * `client_secret_post`.
 *
 * @param methods - The `token_endpoint_auth_methods_supported` the issuer publishes, if any.
 * @returns `true` for Basic.
 */
function prefersBasic(methods: readonly string[] | undefined): boolean {
  if (methods === undefined) return true;
  return methods.includes('client_secret_basic') || !methods.includes('client_secret_post');
}

/**
 * The identity provider's metadata: the token URL given, or the issuer's discovery document, read
 * as sign-in reads it.
 *
 * @param credentials - The credentials.
 * @param send - Sends the requests.
 * @returns The metadata.
 * @throws {TokenError} When the discovery document cannot be read.
 */
async function serverOf(
  credentials: ClientCredentials,
  send: typeof gatewayFetch,
): Promise<client.ServerMetadata> {
  const { issuer, tokenUrl, clientId } = credentials;
  if (tokenUrl !== null) return { issuer: new URL(tokenUrl).origin, token_endpoint: tokenUrl };
  const url = new URL(issuer ?? '');
  const insecure = url.protocol === 'http:' ? { execute: [client.allowInsecureRequests] } : {};
  const options: client.DiscoveryRequestOptions = {
    [client.customFetch]: customFetchOf(send),
    timeout: timeoutSeconds,
    ...insecure,
  };
  try {
    return (await client.discovery(url, clientId, undefined, undefined, options)).serverMetadata();
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    throw new TokenError(
      `The issuer’s discovery document could not be read (${reason}). Check the issuer, or enter the token URL.`,
    );
  }
}

/**
 * The client configuration: the identity provider's metadata, the client and its secret, and the
 * gateway's fetch.
 *
 * @param credentials - The credentials.
 * @param send - Sends the requests.
 * @returns The configuration.
 */
async function configurationOf(
  credentials: ClientCredentials,
  send: typeof gatewayFetch,
): Promise<client.Configuration> {
  const server = await serverOf(credentials, send);
  const { clientId, clientSecret } = credentials;
  const authentication = prefersBasic(server.token_endpoint_auth_methods_supported)
    ? client.ClientSecretBasic(clientSecret)
    : client.ClientSecretPost(clientSecret);
  const config = new client.Configuration(server, clientId, undefined, authentication);
  config[client.customFetch] = customFetchOf(send);
  config.timeout = timeoutSeconds;
  if (server.token_endpoint?.startsWith('http:')) client.allowInsecureRequests(config);
  return config;
}

/**
 * Asks the identity provider for a token with the client credentials grant.
 *
 * @param credentials - The credentials.
 * @param send - Sends the requests.
 * @param now - The clock.
 * @returns The token.
 */
async function requestToken(
  credentials: ClientCredentials,
  send: typeof gatewayFetch,
  now: () => number,
): Promise<IssuedToken> {
  const config = await configurationOf(credentials, send);
  const { scope, audience } = credentials;
  const parameters = { ...(scope ? { scope } : {}), ...(audience ? { audience } : {}) };
  const response = await client.clientCredentialsGrant(config, parameters);
  const lifetime = response.expiresIn() ?? defaultLifetimeSeconds;
  const issuerHost = new URL(config.serverMetadata().token_endpoint ?? '').host;
  return { accessToken: response.access_token, expiresAt: now() + lifetime * 1000, issuerHost };
}

/**
 * Why the identity provider refused, in its own words, with the secret masked should it echo it.
 *
 * @param error - The refusal.
 * @param secret - The client secret.
 * @returns The message.
 */
function refusalOf(error: client.ResponseBodyError, secret: string): string {
  const description = error.error_description;
  const detail = description ? `: ${description.slice(0, 300)}` : '.';
  return `The identity provider refused the client (${error.error})${detail}`.replaceAll(
    secret,
    '•••',
  );
}

/**
 * {@link requestToken}, with a failure to reach the identity provider said as a {@link TokenError}.
 *
 * @param credentials - The credentials.
 * @param send - Sends the requests.
 * @param now - The clock.
 * @returns The token.
 * @throws {TokenError} When no token could be had.
 */
async function fetchToken(
  credentials: ClientCredentials,
  send: typeof gatewayFetch,
  now: () => number,
): Promise<IssuedToken> {
  try {
    return await requestToken(credentials, send, now);
  } catch (error) {
    if (error instanceof TokenError) throw error;
    if (error instanceof client.ResponseBodyError)
      throw new TokenError(refusalOf(error, credentials.clientSecret));
    const reason = error instanceof Error ? error.message : 'unknown error';
    throw new TokenError(`The identity provider could not be reached: ${reason}`);
  }
}

/**
 * When a token is renewed: a minute before it expires, or halfway through a shorter life.
 *
 * @param token - The token.
 * @param issuedAt - When it was issued.
 * @returns The time to renew it, in milliseconds since the epoch.
 */
function renewalOf(token: IssuedToken, issuedAt: number): number {
  return token.expiresAt - Math.min(renewBeforeMs, (token.expiresAt - issuedAt) / 2);
}

/**
 * Creates a token source.
 *
 * @param options - How requests are sent, the gateway fetch with its outbound checks by default,
 *   and the clock.
 * @returns The source.
 */
export function createTokenSource(
  options: { readonly send?: typeof gatewayFetch; readonly now?: () => number } = {},
): TokenSource {
  const { send = gatewayFetch, now = Date.now } = options;
  const cache = new Map<string, { token: IssuedToken; renewAt: number }>();
  const pending = new Map<string, Promise<IssuedToken>>();
  return {
    token(credentials) {
      const key = cacheKey(credentials);
      const cached = cache.get(key);
      if (cached && cached.renewAt > now()) return Promise.resolve(cached.token);
      const inFlight = pending.get(key);
      if (inFlight) return inFlight;
      const issuedAt = now();
      const request = fetchToken(credentials, send, now)
        .then((token) => {
          cache.set(key, { token, renewAt: renewalOf(token, issuedAt) });
          return token;
        })
        .finally(() => pending.delete(key));
      pending.set(key, request);
      return request;
    },
    forget: (credentials) => void cache.delete(cacheKey(credentials)),
  };
}

/** The tokens of the model providers, for the whole server. */
export const modelTokens = createTokenSource();

/**
 * The credentials of a provider reached through an identity provider.
 *
 * @param auth - How the provider is reached.
 * @param secret - The stored client secret, if any.
 * @returns The credentials, or `null` for a provider reached with a key or without a secret.
 */
export function clientCredentialsOf(
  auth: ProviderAuth | undefined,
  secret: string | null,
): ClientCredentials | null {
  if (auth?.type !== 'oauth-client-credentials' || secret === null) return null;
  return { ...auth, clientSecret: secret };
}

/**
 * A fetch that sends each request with the provider's token as a bearer token, in place of any key
 * header the model SDK set. A 401 drops the token and tries once more with a new one.
 *
 * @param tokens - The token source.
 * @param credentials - The credentials.
 * @param send - Sends the requests; the gateway fetch by default.
 * @returns The fetch.
 */
export function bearerFetch(
  tokens: TokenSource,
  credentials: ClientCredentials,
  send: typeof gatewayFetch = gatewayFetch,
): typeof gatewayFetch {
  const withToken = async (
    input: string | URL | Request,
    init: RequestInit | undefined,
    retry: boolean,
  ): Promise<Response> => {
    const issued = await tokens.token(credentials);
    const headers = new Headers(init?.headers);
    headers.delete('x-api-key');
    headers.delete('api-key');
    headers.set('Authorization', `Bearer ${issued.accessToken}`);
    const response = await send(input, { ...init, headers });
    if (response.status !== 401 || !retry) return response;
    tokens.forget(credentials);
    return withToken(input, init, false);
  };
  // A body that is not a string, such as a stream, cannot be sent twice.
  const call = (input: string | URL | Request, init?: RequestInit) =>
    withToken(input, init, (init?.body ?? null) === null || typeof init?.body === 'string');
  return Object.assign(call, { preconnect: gatewayFetch.preconnect });
}
