/**
 * The sign-in providers as admins set them: kind, name, join policy, and the client id and secret,
 * sealed together and never sent back. Changing how a provider signs people in turns it off until
 * a test sign-in succeeds again.
 */
import {
  type IdentityProviderView,
  type JoinPolicy,
  type ProviderKind,
  providerCallbackPath,
  type StoredProvider,
} from '@querent/shared';
import { AppError } from '../../lib/errors.ts';

/** A provider's client id and secret. */
export interface ProviderCredentials {
  /** The client id. */
  readonly clientId: string;
  /** The client secret. */
  readonly clientSecret: string;
}

/** What an admin sends to create or change a provider. */
export interface ProviderInput {
  /** The kind. */
  readonly kind: ProviderKind;
  /** The name on the sign-in button. */
  readonly name: string;
  /** GitLab only: a self-managed GitLab's address. */
  readonly baseUrl: string | null;
  /** Entra only: the tenant's id or domain. */
  readonly tenant: string | null;
  /** Who may join without an invite. */
  readonly join: JoinPolicy;
  /** A new client id. */
  readonly clientId?: string | undefined;
  /** A new client secret. */
  readonly clientSecret?: string | undefined;
}

/** The join modes each kind can check. */
const joinModes: Readonly<Record<ProviderKind, readonly JoinPolicy['mode'][]>> = {
  github: ['invite', 'organisation'],
  google: ['invite', 'domain'],
  gitlab: ['invite', 'domain', 'group'],
  entra: ['invite', 'tenant'],
};

/** Entra's shared tenants, which let in any Microsoft account; querent needs one tenant. */
const sharedTenants = new Set(['common', 'organizations', 'consumers']);

/** An Entra tenant: a GUID, or a domain. */
const tenantPattern =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z0-9-]+(\.[a-z0-9-]+)+)$/i;

/**
 * A GitLab address: HTTPS, or HTTP on this machine, and an origin with no path.
 *
 * @param baseUrl - The address.
 * @returns The origin.
 * @throws {AppError} `bad_request` when it is not such an address.
 */
export function gitlabOrigin(baseUrl: string): string {
  const refuse = () => new AppError('bad_request', 'Give the GitLab address as https://host.');
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw refuse();
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const secure = url.protocol === 'https:' || (url.protocol === 'http:' && loopback);
  if (!secure || url.pathname !== '/' || url.search || url.username) throw refuse();
  return url.origin;
}

/**
 * The join policy of a provider, checked for its kind: domains are compared lowercase.
 *
 * @param input - What the admin sent.
 * @returns The policy.
 * @throws {AppError} `bad_request` for a mode the kind cannot check, or one without values.
 */
function checkedJoin(input: ProviderInput): JoinPolicy {
  const allowed = joinModes[input.kind];
  if (!allowed.includes(input.join.mode))
    throw new AppError(
      'bad_request',
      `A ${input.kind} provider lets people join by ${allowed.join(' or ')}.`,
    );
  const needsValues = input.join.mode !== 'invite' && input.join.mode !== 'tenant';
  if (needsValues && input.join.values.length === 0)
    throw new AppError('bad_request', 'Name at least one domain, organisation or group.');
  const values = needsValues ? input.join.values.map((value) => value.toLowerCase()) : [];
  return { mode: input.join.mode, values };
}

/**
 * The Entra tenant of a provider: one tenant, never a shared one.
 *
 * @param input - What the admin sent.
 * @returns The tenant, or `null` for other kinds.
 * @throws {AppError} `bad_request` for a shared or malformed tenant.
 */
function checkedTenant(input: ProviderInput): string | null {
  if (input.kind !== 'entra') return null;
  const tenant = input.tenant?.trim() ?? '';
  if (!tenantPattern.test(tenant) || sharedTenants.has(tenant.toLowerCase()))
    throw new AppError('bad_request', 'Give one Entra tenant: its id or its domain, not common.');
  return tenant;
}

/**
 * The stored settings of a provider from what an admin sent, checked for its kind.
 *
 * @param input - What the admin sent.
 * @returns The kind-specific fields and the join policy.
 * @throws {AppError} `bad_request` for a field the kind refuses.
 */
export function checkedFields(input: ProviderInput) {
  const baseUrl = input.kind === 'gitlab' && input.baseUrl ? gitlabOrigin(input.baseUrl) : null;
  return { baseUrl, tenant: checkedTenant(input), join: checkedJoin(input) };
}

/**
 * A provider as an admin sees it.
 *
 * @param provider - The stored provider.
 * @param hasCredentials - Whether its client id and secret are saved.
 * @param publicUrl - querent's origin, for the callback URL.
 * @returns The view.
 */
export function providerView(
  provider: StoredProvider,
  hasCredentials: boolean,
  publicUrl: string,
): IdentityProviderView {
  return { ...provider, hasCredentials, callbackUrl: callbackUrlOf(publicUrl, provider.id) };
}

/**
 * What the credentials of a provider are sealed for.
 *
 * @param providerId - The provider.
 * @returns The owner the seal is bound to.
 */
export function credentialsOwner(providerId: string): string {
  return `sign-in.${providerId}`;
}

/**
 * The redirect URI of a provider: fixed by `QUERENT_PUBLIC_URL`, never by a request's Host header.
 *
 * @param publicUrl - querent's origin.
 * @param providerId - The provider.
 * @returns The URI.
 */
export function callbackUrlOf(publicUrl: string, providerId: string): string {
  return `${publicUrl}${providerCallbackPath(providerId)}`;
}
