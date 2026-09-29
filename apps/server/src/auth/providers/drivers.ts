/**
 * How each provider signs people in. Google, GitLab and Entra ID speak OpenID Connect: their
 * configuration comes from discovery, and the ID token's signature (against the provider's
 * published keys, not only TLS), issuer, audience, expiry and nonce are checked by
 * `openid-client`. GitHub speaks plain OAuth 2: querent reads the person and
 * their verified primary email from GitHub's API with the access token, then drops the token.
 * Provider tokens are never stored.
 */
import type { ProviderKind, StoredProvider } from '@querent/shared';
import * as client from 'openid-client';
import type { ProviderCredentials } from './provider-settings.ts';

/** Who the provider says the person is, and whether its join policy lets them in. */
export interface ProviderIdentity {
  /** The provider's stable id of the person. */
  readonly subject: string;
  /** Their email, if the provider gives one. */
  readonly email: string | null;
  /** Whether the provider vouches for the email. */
  readonly emailVerified: boolean;
  /** Their name, for a new user. */
  readonly name: string;
  /** Whether the provider's join policy lets them in without an invite. */
  readonly joinable: boolean;
}

/** What drivers may be given, for tests. */
export interface DriverOptions {
  /** Fetches the provider's APIs; the global `fetch` by default. */
  readonly fetch?: typeof fetch;
  /** Allows plain HTTP to a provider on this machine, as a GitLab under test. */
  readonly allowHttp?: boolean;
}

/** How one kind of provider signs people in. */
export interface Driver {
  /** Whether it speaks OpenID Connect, with an ID token and a nonce. */
  readonly oidc: boolean;
  /**
   * The scopes to ask for.
   *
   * @param provider - The provider.
   * @returns The scopes, space separated.
   */
  scope(provider: StoredProvider): string;
  /** Extra authorization parameters, such as letting the person choose an account. */
  readonly parameters: Readonly<Record<string, string>>;
  /**
   * The client configuration.
   *
   * @param provider - The provider.
   * @param credentials - Its client id and secret.
   * @param options - Test options.
   * @returns The configuration.
   */
  configure(
    provider: StoredProvider,
    credentials: ProviderCredentials,
    options: DriverOptions,
  ): Promise<client.Configuration>;
  /**
   * Who the tokens say the person is.
   *
   * @param config - The client configuration.
   * @param tokens - The token response.
   * @param provider - The provider.
   * @param options - Test options.
   * @returns The identity.
   */
  identify(
    config: client.Configuration,
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    provider: StoredProvider,
    options: DriverOptions,
  ): Promise<ProviderIdentity>;
}

/** How long a request to a provider may take. */
const timeoutSeconds = 10;

/**
 * Discovers an OpenID Connect provider.
 *
 * @param issuer - Its issuer URL.
 * @param credentials - The client id and secret.
 * @param allowHttp - Whether plain HTTP is allowed, for a provider on this machine.
 * @returns The configuration.
 */
async function discover(
  issuer: string,
  credentials: ProviderCredentials,
  allowHttp = false,
): Promise<client.Configuration> {
  const options = allowHttp ? { execute: [client.allowInsecureRequests] } : undefined;
  const config = await client.discovery(
    new URL(issuer),
    credentials.clientId,
    credentials.clientSecret,
    undefined,
    options,
  );
  config.timeout = timeoutSeconds;
  // TLS already vouches for a token from the token endpoint; the signature is checked against the
  // provider's published keys too, so a token that did not come from it never counts.
  client.enableNonRepudiationChecks(config);
  return config;
}

/**
 * The domain of an email.
 *
 * @param email - The email.
 * @returns The domain, lowercase.
 */
function domainOf(email: string | null): string {
  return (email?.split('@')[1] ?? '').toLowerCase();
}

/**
 * The checked claims of the ID token.
 *
 * @param tokens - The token response.
 * @returns The claims.
 * @throws {Error} When there is no ID token.
 */
function claimsOf(tokens: client.TokenEndpointResponseHelpers): Record<string, unknown> {
  const claims = tokens.claims();
  if (!claims) throw new Error('The provider sent no ID token.');
  return claims;
}

/**
 * A text claim.
 *
 * @param claims - The claims.
 * @param name - The claim.
 * @returns Its value, or `null`.
 */
function text(claims: Record<string, unknown>, name: string): string | null {
  const value = claims[name];
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Google: a Workspace domain joins through the `hd` claim, which Google sets itself. */
const google: Driver = {
  oidc: true,
  scope: () => 'openid email profile',
  parameters: { prompt: 'select_account' },
  configure: (_provider, credentials) => discover('https://accounts.google.com', credentials),
  identify: async (_config, tokens, provider) => {
    const claims = claimsOf(tokens);
    const email = text(claims, 'email');
    const emailVerified = claims.email_verified === true;
    const domain = text(claims, 'hd')?.toLowerCase() ?? '';
    const joinable =
      provider.join.mode === 'domain' && emailVerified && provider.join.values.includes(domain);
    return {
      subject: String(claims.sub),
      email,
      emailVerified,
      name: text(claims, 'name') ?? email ?? 'Someone',
      joinable,
    };
  },
};

/**
 * The GitLab groups of a person, full paths, from the userinfo endpoint.
 *
 * @param config - The client configuration.
 * @param tokens - The token response.
 * @param subject - The person.
 * @returns The groups.
 */
async function gitlabGroups(
  config: client.Configuration,
  tokens: client.TokenEndpointResponse,
  subject: string,
): Promise<string[]> {
  const info = await client.fetchUserInfo(config, tokens.access_token, subject);
  return Array.isArray(info.groups) ? info.groups.map((group) => String(group).toLowerCase()) : [];
}

/** GitLab: a verified email's domain, or a group or one of its subgroups, joins. */
const gitlab: Driver = {
  oidc: true,
  scope: () => 'openid email profile',
  parameters: {},
  configure: (provider, credentials, options) =>
    discover(provider.baseUrl ?? 'https://gitlab.com', credentials, options.allowHttp),
  identify: async (config, tokens, provider) => {
    const claims = claimsOf(tokens);
    const subject = String(claims.sub);
    const email = text(claims, 'email');
    const emailVerified = claims.email_verified === true;
    const { mode, values } = provider.join;
    const inDomain = mode === 'domain' && emailVerified && values.includes(domainOf(email));
    const groups = mode === 'group' ? await gitlabGroups(config, tokens, subject) : [];
    const inGroup = groups.some((group) =>
      values.some((value) => group === value || group.startsWith(`${value}/`)),
    );
    const name = text(claims, 'name') ?? text(claims, 'nickname') ?? email ?? 'Someone';
    return { subject, email, emailVerified, name, joinable: inDomain || inGroup };
  },
};

/**
 * Entra ID: one tenant only, so discovery's issuer names it and a token from another tenant fails
 * the issuer check. The person is their tenant and object ids; their email is the sign-in name
 * the tenant gave them.
 */
const entra: Driver = {
  oidc: true,
  scope: () => 'openid email profile',
  parameters: { prompt: 'select_account' },
  configure: (provider, credentials) =>
    discover(`https://login.microsoftonline.com/${provider.tenant ?? ''}/v2.0`, credentials),
  identify: async (_config, tokens, provider) => {
    const claims = claimsOf(tokens);
    const tenant = text(claims, 'tid');
    const object = text(claims, 'oid');
    if (!tenant || !object) throw new Error('The Entra token names no tenant or object.');
    const email = text(claims, 'preferred_username') ?? text(claims, 'email');
    const name = text(claims, 'name') ?? email ?? 'Someone';
    return {
      subject: `${tenant}:${object}`,
      email,
      emailVerified: email !== null,
      name,
      joinable: provider.join.mode === 'tenant',
    };
  },
};

/**
 * Calls GitHub's API with an access token.
 *
 * @param fetcher - The fetch function.
 * @param token - The access token.
 * @param path - The API path.
 * @returns The response.
 */
function github(fetcher: typeof fetch, token: string, path: string): Promise<Response> {
  return fetcher(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'querent',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(timeoutSeconds * 1000),
  });
}

/**
 * Whether a person is an active member of one of the organisations.
 *
 * @param fetcher - The fetch function.
 * @param token - The access token.
 * @param organisations - The organisations.
 * @returns Whether they are.
 */
async function inOrganisation(
  fetcher: typeof fetch,
  token: string,
  organisations: readonly string[],
): Promise<boolean> {
  for (const organisation of organisations) {
    const response = await github(
      fetcher,
      token,
      `/user/memberships/orgs/${encodeURIComponent(organisation)}`,
    );
    if (response.ok && ((await response.json()) as { state?: string }).state === 'active')
      return true;
  }
  return false;
}

/**
 * Who a GitHub token belongs to: their numeric id, name, and verified primary email.
 *
 * @param fetcher - The fetch function.
 * @param token - The access token.
 * @returns The person.
 * @throws {Error} When GitHub does not answer.
 */
export async function githubPerson(fetcher: typeof fetch, token: string) {
  const user = await github(fetcher, token, '/user');
  const emails = await github(fetcher, token, '/user/emails');
  if (!user.ok || !emails.ok)
    throw new Error(`GitHub answered ${user.status} and ${emails.status}.`);
  const person = (await user.json()) as { id: number; login: string; name: string | null };
  const list = (await emails.json()) as { email: string; primary: boolean; verified: boolean }[];
  const primary = list.find((each) => each.primary && each.verified);
  return {
    subject: String(person.id),
    name: person.name ?? person.login,
    email: primary?.email ?? null,
  };
}

/** GitHub: OAuth 2 with PKCE; an organisation's active members join. */
const githubDriver: Driver = {
  oidc: false,
  scope: (provider) =>
    provider.join.mode === 'organisation'
      ? 'read:user user:email read:org'
      : 'read:user user:email',
  parameters: {},
  configure: async (_provider, credentials) => {
    const server = {
      issuer: 'https://github.com',
      authorization_endpoint: 'https://github.com/login/oauth/authorize',
      token_endpoint: 'https://github.com/login/oauth/access_token',
    };
    const config = new client.Configuration(server, credentials.clientId, credentials.clientSecret);
    config.timeout = timeoutSeconds;
    return config;
  },
  identify: async (_config, tokens, provider, options) => {
    const fetcher = options.fetch ?? fetch;
    const person = await githubPerson(fetcher, tokens.access_token);
    const joinable =
      provider.join.mode === 'organisation' &&
      (await inOrganisation(fetcher, tokens.access_token, provider.join.values));
    return { ...person, emailVerified: person.email !== null, joinable };
  },
};

/** The driver of each kind. */
export const drivers: Readonly<Record<ProviderKind, Driver>> = {
  github: githubDriver,
  google,
  gitlab,
  entra,
};
