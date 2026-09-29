/**
 * Sign-in providers: GitHub, Google, GitLab and Microsoft Entra ID. querent is only a client of
 * theirs; admins register it with each and paste the client id and secret here. The secret never
 * leaves the server again.
 */
import { z } from 'zod';
import { defineEndpoint } from './contract.ts';

/** The providers querent signs in with. */
export const providerKinds = ['github', 'google', 'gitlab', 'entra'] as const;

/** A provider kind. */
export type ProviderKind = (typeof providerKinds)[number];

/**
 * Who may join through a provider without an invite: nobody (`invite`), or anyone with a verified
 * email at a domain, a member of a GitHub organisation or GitLab group, or anyone in the Entra
 * tenant. People who join start as viewers.
 */
export const joinPolicySchema = z.object({
  mode: z.enum(['invite', 'domain', 'organisation', 'group', 'tenant']),
  values: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
});

/** Who may join through a provider without an invite. */
export type JoinPolicy = z.infer<typeof joinPolicySchema>;

/** Validates a provider as stored in the settings, without its credentials. */
export const storedProviderSchema = z.object({
  id: z.string(),
  kind: z.enum(providerKinds),
  name: z.string(),
  enabled: z.boolean(),
  baseUrl: z.string().nullable(),
  tenant: z.string().nullable(),
  join: joinPolicySchema,
  testedAt: z.number().nullable(),
});

/** A provider as stored in the settings, without its credentials. */
export type StoredProvider = z.infer<typeof storedProviderSchema>;

/** Validates the stored sign-in settings. */
export const storedSignInSchema = z.object({
  providers: z.array(storedProviderSchema).default([]),
  passwordSignIn: z.boolean().default(true),
});

/** Validates a provider as an admin sees it. */
export const identityProviderSchema = z.object({
  id: z.string(),
  kind: z.enum(providerKinds),
  name: z.string(),
  enabled: z.boolean(),
  /** GitLab only: the address of a self-managed GitLab; gitlab.com when `null`. */
  baseUrl: z.string().nullable(),
  /** Entra only: the tenant's id or domain. */
  tenant: z.string().nullable(),
  join: joinPolicySchema,
  /** Whether a client id and secret are saved; they are never sent back. */
  hasCredentials: z.boolean(),
  /** When a test sign-in last succeeded with the current settings; enabling needs one. */
  testedAt: z.number().nullable(),
  /** The address to register at the provider as the redirect URI. */
  callbackUrl: z.string(),
  /** The configuration file that manages it, when one does; it is read-only here then. */
  managedBy: z.string().optional(),
});

/** A provider as an admin sees it. */
export type IdentityProviderView = z.infer<typeof identityProviderSchema>;

/** The sign-in settings, for admins. */
export const identityProvidersSchema = z.object({
  providers: z.array(identityProviderSchema),
  /** Whether people may sign in with a password. */
  passwordSignIn: z.boolean(),
  /** querent's origin, which callback URLs start with; `null` when the server has none. */
  publicUrl: z.string().nullable(),
});

/** The sign-in settings, for admins. */
export type IdentityProvidersView = z.infer<typeof identityProvidersSchema>;

/** The sign-in settings, for admins. */
export const getIdentityProvidersEndpoint = defineEndpoint({
  method: 'GET',
  path: '/settings/identity-providers',
  output: identityProvidersSchema,
});

/** The path parameter of one provider. */
const providerParams = z.object({ providerId: z.string().regex(/^[a-z0-9-]{1,40}$/) });

/**
 * Creates or changes a provider. The client id and secret are written only when sent. Changing how
 * it signs people in turns it off until a test sign-in succeeds again.
 */
export const saveIdentityProviderEndpoint = defineEndpoint({
  method: 'PUT',
  path: '/settings/identity-providers/:providerId',
  params: providerParams,
  body: z.object({
    kind: z.enum(providerKinds),
    name: z.string().trim().min(1).max(60),
    baseUrl: z.string().trim().max(200).nullable().default(null),
    tenant: z.string().trim().max(100).nullable().default(null),
    join: joinPolicySchema,
    clientId: z.string().trim().min(1).max(500).optional(),
    clientSecret: z.string().trim().min(1).max(2000).optional(),
  }),
  output: identityProvidersSchema,
});

/** Turns a provider on, after a successful test sign-in, or off. */
export const enableIdentityProviderEndpoint = defineEndpoint({
  method: 'POST',
  path: '/settings/identity-providers/:providerId/enabled',
  params: providerParams,
  body: z.object({ enabled: z.boolean() }),
  output: identityProvidersSchema,
});

/** Removes a provider, its credentials and every identity linked through it. */
export const removeIdentityProviderEndpoint = defineEndpoint({
  method: 'DELETE',
  path: '/settings/identity-providers/:providerId',
  params: providerParams,
  output: identityProvidersSchema,
});

/** Turns password sign-in on or off. Off needs an admin who can sign in through a provider. */
export const passwordSignInEndpoint = defineEndpoint({
  method: 'PUT',
  path: '/settings/password-sign-in',
  body: z.object({ enabled: z.boolean() }),
  output: identityProvidersSchema,
});

/** How people may sign in, for the login page. */
export const signInOptionsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/auth/options',
  output: z.object({
    passwordSignIn: z.boolean(),
    providers: z.array(z.object({ id: z.string(), name: z.string(), kind: z.enum(providerKinds) })),
  }),
});

/** The providers linked to the signed-in person, and those they may link. */
export const myIdentitiesEndpoint = defineEndpoint({
  method: 'GET',
  path: '/auth/identities',
  output: z.object({
    linked: z.array(z.object({ providerId: z.string(), name: z.string(), linkedAt: z.number() })),
    available: z.array(z.object({ id: z.string(), name: z.string(), kind: z.enum(providerKinds) })),
    hasPassword: z.boolean(),
  }),
});

/** Unlinks a provider from the signed-in person, unless it is their last way to sign in. */
export const unlinkIdentityEndpoint = defineEndpoint({
  method: 'DELETE',
  path: '/auth/identities/:providerId',
  params: providerParams,
  output: z.object({ unlinked: z.int() }),
});

/**
 * The path a provider sends people back to. Registered at the provider after querent's origin.
 *
 * @param providerId - The provider.
 * @returns The path.
 */
export function providerCallbackPath(providerId: string): string {
  return `/api/auth/providers/${encodeURIComponent(providerId)}/callback`;
}

/** What a provider sign-in flow is for. */
export const providerFlowIntents = ['sign-in', 'link', 'test'] as const;

/**
 * Why a provider sign-in failed, by the code the server puts in the page's `error` parameter, in
 * the words the page shows.
 */
export const providerFlowFailures = {
  expired: 'The sign-in took too long or was started elsewhere. Try again.',
  provider: 'The provider did not confirm who you are. Try again.',
  'not-invited': 'You have no account here. Ask an admin for an invite.',
  'link-first':
    'An account with this email exists. Sign in with its password, then link this provider from the account menu.',
  unverified: 'The provider has no verified email for you.',
  disabled: 'This account is disabled.',
  'linked-elsewhere': 'This provider account is linked to someone else here.',
  off: 'This way of signing in is off.',
} as const;

/** A provider sign-in failure code. */
export type ProviderFlowFailure = keyof typeof providerFlowFailures;

/**
 * The words of a failure code from a page's `error` parameter.
 *
 * @param code - The code, as the page received it.
 * @returns The words, or `undefined` for no code or an unknown one.
 */
export function providerFlowFailure(code: string | null): string | undefined {
  if (code === null || !Object.hasOwn(providerFlowFailures, code)) return undefined;
  return providerFlowFailures[code as ProviderFlowFailure];
}

/**
 * The start of a provider flow: a full-page GET that redirects to the provider. Not a JSON
 * endpoint; its path is shared so the web app builds links to it.
 *
 * @param providerId - The provider.
 * @param intent - Signing in, linking to the signed-in user, or an admin's test.
 * @param next - Where to go after signing in, a local path.
 * @returns The path.
 */
export function providerStartPath(
  providerId: string,
  intent: (typeof providerFlowIntents)[number],
  next = '/',
): string {
  const query = `intent=${encodeURIComponent(intent)}&next=${encodeURIComponent(next)}`;
  return `/api/auth/providers/${encodeURIComponent(providerId)}/start?${query}`;
}
