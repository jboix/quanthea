/**
 * Signing in through a provider: the authorization code flow with PKCE, a state and, for OpenID
 * Connect, a nonce. The three live in a short-lived cookie, sealed with the secret key and used
 * once, so a callback only completes in the browser that started it. The callback's address is
 * built from `QUERENT_PUBLIC_URL`, never from the request.
 *
 * A person comes in when their provider identity is linked to a user, when they were invited with
 * the verified email the provider gives, or when the provider's join policy lets them in, as a
 * viewer. An account in use is never linked by email alone: its owner links the provider from
 * their account page, signed in.
 */
import {
  type Principal,
  type ProviderFlowFailure,
  providerFlowFailures,
  type providerFlowIntents,
} from '@querent/shared';
import * as client from 'openid-client';
import type { AuditRepository } from '../../db/audit-repository.ts';
import type { IdentityRepository } from '../../db/identity-repository.ts';
import type { UserRepository, UserRow } from '../../db/user-repository.ts';
import type { KeyedHash } from '../../secrets/keyed-hash.ts';
import type { SecretBox } from '../../secrets/secret-box.ts';
import type { Sessions } from '../sessions.ts';
import type { Users } from '../users.ts';
import { type DriverOptions, drivers, type ProviderIdentity } from './drivers.ts';
import { callbackUrlOf } from './provider-settings.ts';
import type { SignInSettings } from './sign-in-settings.ts';

/** What a flow is for: signing in, linking to the signed-in person, or an admin's test. */
export type FlowIntent = (typeof providerFlowIntents)[number];

/** How long a flow may take, from start to callback. */
const flowLifetimeMs = 10 * 60_000;

/** What the flow cookie's seal is bound to. */
const flowOwner = 'sign-in-flow';

/** A failure code. */
export type FlowFailure = ProviderFlowFailure;

/** A flow that failed, with its code. */
export class FlowError extends Error {
  /** Why it failed. */
  readonly failure: FlowFailure;
  /** What the flow was for, once known. */
  intent: FlowIntent | undefined;

  /**
   * Creates the error.
   *
   * @param failure - Why it failed.
   */
  constructor(failure: FlowFailure) {
    super(providerFlowFailures[failure]);
    this.name = 'FlowError';
    this.failure = failure;
    this.intent = undefined;
  }
}

/** What a flow remembers between start and callback. */
interface FlowState {
  /** The provider. */
  readonly providerId: string;
  /** What it is for. */
  readonly intent: FlowIntent;
  /** Where to go after signing in. */
  readonly next: string;
  /** The state sent to the provider. */
  readonly state: string;
  /** The nonce sent to the provider, for OpenID Connect. */
  readonly nonce: string | undefined;
  /** The PKCE verifier. */
  readonly verifier: string;
  /** The signed-in person, for a link or a test. */
  readonly userId: string | undefined;
  /** When the flow stops working. */
  readonly expiresAt: number;
}

/** How a flow ended. */
export type FlowOutcome =
  | { readonly kind: 'signed-in'; readonly cookie: string; readonly next: string }
  | { readonly kind: 'linked' }
  | { readonly kind: 'tested' };

/** What provider flows need. */
export interface ProviderFlowDependencies {
  /** The sign-in settings. */
  readonly settings: SignInSettings;
  /** Seals the flow cookie and the identities' subjects. */
  readonly secretBox: SecretBox;
  /** Hashes subjects and emails for lookups. */
  readonly lookupIndex: KeyedHash;
  /** Stores identities. */
  readonly identities: IdentityRepository;
  /** Stores users. */
  readonly userRows: UserRepository;
  /** Creates and finds users. */
  readonly users: Pick<Users, 'create' | 'findByEmail'>;
  /** Starts sessions. */
  readonly sessions: Pick<Sessions, 'start'>;
  /** Records who did what. */
  readonly audit: AuditRepository;
  /** querent's origin. */
  readonly publicUrl: string;
  /** Test options for the drivers. */
  readonly driverOptions?: DriverOptions;
  /** The clock; `Date.now` by default. */
  readonly now?: () => number;
}

/** The dependencies with the clock resolved. */
type Context = ProviderFlowDependencies & { readonly now: () => number };

/**
 * The provider, its driver and its client configuration.
 *
 * @param context - The flow context.
 * @param providerId - The provider.
 * @returns The provider, driver and configuration.
 * @throws {FlowError} `off` when there is no such provider or no credentials.
 */
async function clientOf(context: Context, providerId: string) {
  const provider = context.settings.provider(providerId);
  const credentials = await context.settings.credentials(providerId);
  if (!provider || !credentials) throw new FlowError('off');
  const driver = drivers[provider.kind];
  const config = await driver.configure(provider, credentials, context.driverOptions ?? {});
  return { provider, driver, config };
}

/**
 * Checks a flow may start.
 *
 * @param context - The flow context.
 * @param providerId - The provider.
 * @param intent - What it is for.
 * @param principal - Who starts it, if signed in.
 * @throws {FlowError} `off` for a provider that is off, or a link or test by someone who may not.
 */
function checkStart(
  context: Context,
  providerId: string,
  intent: FlowIntent,
  principal: Principal | null,
): void {
  const enabled = context.settings.provider(providerId)?.enabled === true;
  const allowed = {
    'sign-in': enabled,
    link: enabled && principal !== null && principal.id !== 'anonymous',
    test: principal?.role === 'admin',
  }[intent];
  if (!allowed) throw new FlowError('off');
}

/**
 * Starts a flow.
 *
 * @param context - The flow context.
 * @param input - The provider, what the flow is for, where to go next, and who starts it.
 * @param input.providerId - The provider.
 * @param input.intent - What the flow is for.
 * @param input.next - Where to go after signing in.
 * @param input.principal - Who starts it, if signed in.
 * @returns The provider's authorization URL, and the sealed flow cookie.
 */
async function start(
  context: Context,
  input: { providerId: string; intent: FlowIntent; next: string; principal: Principal | null },
): Promise<{ location: string; flowCookie: string }> {
  checkStart(context, input.providerId, input.intent, input.principal);
  const { provider, driver, config } = await clientOf(context, input.providerId);
  const verifier = client.randomPKCECodeVerifier();
  const state = client.randomState();
  const nonce = driver.oidc ? client.randomNonce() : undefined;
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: callbackUrlOf(context.publicUrl, provider.id),
    scope: driver.scope(provider),
    state,
    code_challenge: await client.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256',
    ...(nonce ? { nonce } : {}),
    ...driver.parameters,
  });
  const flow: FlowState = {
    ...input,
    userId: input.principal?.id,
    state,
    nonce,
    verifier,
    expiresAt: context.now() + flowLifetimeMs,
  };
  const sealed = await context.secretBox.seal(JSON.stringify(flow), flowOwner);
  return { location: url.href, flowCookie: Buffer.from(sealed).toString('base64url') };
}

/**
 * Opens the flow cookie.
 *
 * @param context - The flow context.
 * @param flowCookie - The cookie value.
 * @param providerId - The provider the callback names.
 * @returns The flow.
 * @throws {FlowError} `expired` when it is missing, altered, for another provider, or too old.
 */
async function openFlow(context: Context, flowCookie: string | undefined, providerId: string) {
  if (!flowCookie) throw new FlowError('expired');
  const flow = await context.secretBox
    .open(new Uint8Array(Buffer.from(flowCookie, 'base64url')), flowOwner)
    .then((text) => JSON.parse(text) as FlowState)
    .catch(() => undefined);
  if (!flow || flow.providerId !== providerId || flow.expiresAt <= context.now())
    throw new FlowError('expired');
  return flow;
}

/**
 * The key an identity is found by: a keyed hash of the provider and its subject.
 *
 * @param context - The flow context.
 * @param providerId - The provider.
 * @param subject - The subject.
 * @returns The hash.
 */
function subjectIndexOf(context: Context, providerId: string, subject: string) {
  return context.lookupIndex.hash(`identity:${providerId}:${subject}`);
}

/**
 * Links an identity to a user.
 *
 * @param context - The flow context.
 * @param providerId - The provider.
 * @param subject - The subject.
 * @param userId - The user.
 * @throws {FlowError} `linked-elsewhere` when the identity belongs to someone else.
 */
async function link(context: Context, providerId: string, subject: string, userId: string) {
  const subjectIndex = await subjectIndexOf(context, providerId, subject);
  const existing = context.identities.find(providerId, subjectIndex);
  if (existing && existing.userId !== userId) throw new FlowError('linked-elsewhere');
  if (existing) return;
  const subjectSealed = await context.secretBox.seal(subject, `identity.${providerId}`);
  const row = {
    providerId,
    subjectIndex,
    subjectSealed,
    userId,
    createdAt: context.now(),
    lastUsedAt: null,
  };
  context.identities.link(row);
  context.audit.append({ actor: userId, action: 'user.identity-link', detail: { providerId } });
}

/**
 * Whether a user is a pending invite: never signed in, no password, no provider, enabled.
 *
 * @param context - The flow context.
 * @param row - The user.
 * @returns Whether they are.
 */
function isPendingInvite(context: Context, row: UserRow): boolean {
  return (
    row.disabledAt === null &&
    row.passwordHash === null &&
    context.identities.listOf(row.id).length === 0
  );
}

/**
 * The user an identity is linked to, if any.
 *
 * @param context - The flow context.
 * @param providerId - The provider.
 * @param subject - The subject.
 * @returns The user's id, or `undefined`.
 * @throws {FlowError} `disabled` when that user is disabled.
 */
async function linkedUser(context: Context, providerId: string, subject: string) {
  const subjectIndex = await subjectIndexOf(context, providerId, subject);
  const linked = context.identities.find(providerId, subjectIndex);
  if (!linked) return undefined;
  if (context.userRows.get(linked.userId)?.disabledAt !== null) throw new FlowError('disabled');
  context.identities.touch(providerId, subjectIndex, context.now());
  return linked.userId;
}

/**
 * Refuses to link a new identity to an account in use, by email alone: its owner links it signed
 * in.
 *
 * @param context - The flow context.
 * @param existing - The user with the identity's email, if any.
 * @throws {FlowError} `link-first` for an account in use, `disabled` for a disabled one.
 */
function refuseAccountInUse(context: Context, existing: UserRow | undefined): void {
  if (!existing || isPendingInvite(context, existing)) return;
  throw new FlowError(existing.disabledAt === null ? 'link-first' : 'disabled');
}

/**
 * The user a new identity signs in as: an invite with its verified email, or someone joining.
 *
 * @param context - The flow context.
 * @param providerId - The provider.
 * @param identity - Who the provider says they are.
 * @returns The user's id, the identity now linked to it.
 * @throws {FlowError} When they may not come in.
 */
async function newcomer(context: Context, providerId: string, identity: ProviderIdentity) {
  if (!identity.emailVerified || !identity.email)
    throw new FlowError(identity.joinable ? 'unverified' : 'not-invited');
  const existing = await context.users.findByEmail(identity.email);
  refuseAccountInUse(context, existing);
  const userId = existing?.id ?? (await join(context, identity));
  await link(context, providerId, identity.subject, userId);
  return userId;
}

/**
 * The user an identity signs in as: linked, invited by email, or joining.
 *
 * @param context - The flow context.
 * @param providerId - The provider.
 * @param identity - Who the provider says they are.
 * @returns The user's id.
 */
async function resolveUser(context: Context, providerId: string, identity: ProviderIdentity) {
  return (
    (await linkedUser(context, providerId, identity.subject)) ??
    (await newcomer(context, providerId, identity))
  );
}

/**
 * Creates a viewer for someone the join policy lets in.
 *
 * @param context - The flow context.
 * @param identity - Who they are.
 * @returns The new user's id.
 * @throws {FlowError} `not-invited` when the policy does not let them in.
 */
async function join(context: Context, identity: ProviderIdentity): Promise<string> {
  if (!identity.joinable || !identity.email) throw new FlowError('not-invited');
  const input = { email: identity.email, name: identity.name, role: 'viewer' as const };
  return (await context.users.create(input, 'sign-in')).id;
}

/**
 * Ends a flow at its callback.
 *
 * @param context - The flow context.
 * @param input - The provider, the callback's query, the flow cookie, and who is signed in.
 * @param input.providerId - The provider the callback names.
 * @param input.search - The callback's query string, with its `?`.
 * @param input.flowCookie - The flow cookie.
 * @param input.principal - Who is signed in, for a link or a test.
 * @returns How it ended.
 */
async function finish(
  context: Context,
  input: {
    providerId: string;
    search: string;
    flowCookie: string | undefined;
    principal: Principal | null;
  },
): Promise<FlowOutcome> {
  const flow = await openFlow(context, input.flowCookie, input.providerId);
  try {
    return await exchange(context, flow, input);
  } catch (error) {
    // The flow is known now, so the person is sent back to the page they started from.
    if (error instanceof FlowError) error.intent = flow.intent;
    throw error;
  }
}

/**
 * Trades the code for tokens, checking the state, the nonce and PKCE, and completes the flow.
 *
 * @param context - The flow context.
 * @param flow - The flow.
 * @param input - The callback's query, and who is signed in.
 * @param input.search - The callback's query string, with its `?`.
 * @param input.principal - Who is signed in, for a link or a test.
 * @returns How it ended.
 */
async function exchange(
  context: Context,
  flow: FlowState,
  input: { search: string; principal: Principal | null },
): Promise<FlowOutcome> {
  const { provider, driver, config } = await clientOf(context, flow.providerId);
  const currentUrl = new URL(`${callbackUrlOf(context.publicUrl, provider.id)}${input.search}`);
  const checks = {
    pkceCodeVerifier: flow.verifier,
    expectedState: flow.state,
    ...(flow.nonce ? { expectedNonce: flow.nonce } : {}),
  };
  const tokens = await client.authorizationCodeGrant(config, currentUrl, checks).catch(() => {
    throw new FlowError('provider');
  });
  const identity = await driver.identify(config, tokens, provider, context.driverOptions ?? {});
  return complete(context, flow, identity, input.principal);
}

/**
 * Completes a flow once the provider confirmed who the person is.
 *
 * @param context - The flow context.
 * @param flow - The flow.
 * @param identity - Who they are.
 * @param principal - Who is signed in, for a link or a test.
 * @returns How it ended.
 * @throws {FlowError} `expired` when a link or test comes back to someone else.
 */
async function complete(
  context: Context,
  flow: FlowState,
  identity: ProviderIdentity,
  principal: Principal | null,
): Promise<FlowOutcome> {
  if (flow.intent !== 'sign-in' && (!principal || principal.id !== flow.userId))
    throw new FlowError('expired');
  if (flow.intent === 'test') {
    context.settings.markTested(flow.providerId, principal?.id ?? 'unknown');
    return { kind: 'tested' };
  }
  if (flow.intent === 'link') {
    await link(context, flow.providerId, identity.subject, principal?.id ?? '');
    return { kind: 'linked' };
  }
  const userId = await resolveUser(context, flow.providerId, identity);
  context.userRows.update(userId, { lastSignInAt: context.now(), updatedAt: context.now() });
  const { cookie } = await context.sessions.start(userId);
  context.audit.append({
    actor: userId,
    action: 'auth.sign-in',
    detail: { method: flow.providerId },
  });
  return { kind: 'signed-in', cookie, next: flow.next };
}

/** Provider flows. */
export interface ProviderFlows {
  /**
   * Starts a flow.
   *
   * @param input - The provider, what the flow is for, where to go next, and who starts it.
   * @returns The provider's authorization URL, and the sealed flow cookie.
   * @throws {FlowError} When the flow may not start.
   */
  start(input: {
    providerId: string;
    intent: FlowIntent;
    next: string;
    principal: Principal | null;
  }): Promise<{ location: string; flowCookie: string }>;
  /**
   * Ends a flow at its callback.
   *
   * @param input - The provider, the callback's query, the flow cookie, and who is signed in.
   * @returns How it ended.
   * @throws {FlowError} When it failed.
   */
  finish(input: {
    providerId: string;
    search: string;
    flowCookie: string | undefined;
    principal: Principal | null;
  }): Promise<FlowOutcome>;
}

/**
 * Creates the provider flows.
 *
 * @param dependencies - The settings, keys, identities, users, sessions, audit log and public URL.
 * @returns The flows.
 */
export function createProviderFlows(dependencies: ProviderFlowDependencies): ProviderFlows {
  const context: Context = { ...dependencies, now: dependencies.now ?? Date.now };
  return { start: (input) => start(context, input), finish: (input) => finish(context, input) };
}
