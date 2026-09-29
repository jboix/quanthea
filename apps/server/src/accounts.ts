/**
 * The account services: users, sessions, passwords, sign-in providers and the authentication
 * mode, wired over one database and the keys.
 */
import type { AuthMode } from '@querent/shared';
import { type AuthModeControl, createAuthModeControl } from './auth/auth-mode-control.ts';
import { createPasswordAccounts, type PasswordAccounts } from './auth/password-accounts.ts';
import type { HashCosts } from './auth/passwords.ts';
import type { DriverOptions } from './auth/providers/drivers.ts';
import {
  createLinkedIdentities,
  type LinkedIdentities,
} from './auth/providers/linked-identities.ts';
import { createProviderFlows, type ProviderFlows } from './auth/providers/provider-flow.ts';
import { createSignInSettings, type SignInSettings } from './auth/providers/sign-in-settings.ts';
import { createSessions, type Sessions } from './auth/sessions.ts';
import { accountRule, addressRule, createThrottle } from './auth/throttle.ts';
import type { UserAdminDependencies } from './auth/user-admin.ts';
import { createUsers, type Users } from './auth/users.ts';
import type { createAuditRepository } from './db/audit-repository.ts';
import type { openDatabase } from './db/database.ts';
import { createIdentityRepository, type IdentityRepository } from './db/identity-repository.ts';
import { createPasswordLinkRepository } from './db/password-link-repository.ts';
import { createSessionRepository } from './db/session-repository.ts';
import { createThreadOwnershipRepository } from './db/thread-ownership.ts';
import { createUserRepository, type UserRepository, type UserRow } from './db/user-repository.ts';
import type { KeyedHash } from './secrets/keyed-hash.ts';
import type { Peppers, SessionHashes } from './secrets/keys.ts';
import type { SecretBox } from './secrets/secret-box.ts';
import type { SettingsStore } from './settings/settings-store.ts';

/** What the account services need. */
export interface AccountDependencies {
  /** A database the migrations have run on. */
  readonly database: ReturnType<typeof openDatabase>;
  /** Seals secrets, names, emails and subjects. */
  readonly secretBox: SecretBox;
  /** The settings store. */
  readonly settings: SettingsStore;
  /** Indexes emails and provider subjects, under a key derived from the secret key. */
  readonly emailIndex: KeyedHash;
  /** The session key's hashes; without them there are no sessions, as in `none` mode. */
  readonly sessionHashes: SessionHashes | undefined;
  /** The peppers; without them there are no passwords. */
  readonly peppers: Peppers | undefined;
  /** The argon2id costs; lower in tests only. */
  readonly passwordCosts?: HashCosts;
  /** The mode `QUERENT_AUTH_MODE` forces, if set. */
  readonly authOverride?: AuthMode | undefined;
  /** What the server lacks for accounts, found at startup; none by default. */
  readonly accountsProblems?: readonly string[];
  /** querent's origin; without it there are no provider sign-ins. */
  readonly publicUrl?: string | undefined;
  /** Test options for the provider drivers. */
  readonly driverOptions?: DriverOptions;
  /** The clock of the users and sessions; `Date.now` by default. */
  readonly now?: () => number;
}

/** The account services. */
export interface Accounts {
  /** The people who sign in. */
  readonly users: Users;
  /** Users as stored. */
  readonly userRows: UserRepository;
  /** Sessions, when the session key is set. */
  readonly sessions: Sessions | undefined;
  /** Password accounts, when the session key and the pepper are set. */
  readonly passwords: PasswordAccounts | undefined;
  /** What changing a user needs. */
  readonly userAdmin: UserAdminDependencies;
  /** The authentication mode, switched without a restart. */
  readonly authMode: AuthModeControl;
  /** The sign-in providers, and whether passwords sign in. */
  readonly signInSettings: SignInSettings;
  /** Provider identities linked to users. */
  readonly identityRows: IdentityRepository;
  /** One's own linked providers. */
  readonly linkedIdentities: LinkedIdentities;
  /** Provider sign-ins, when querent has a public URL and sessions. */
  readonly flows: ProviderFlows | undefined;
}

/** The audit log. */
type Audit = ReturnType<typeof createAuditRepository>;

/**
 * Password accounts, when the session key and the pepper are set.
 *
 * @param dependencies - The account dependencies.
 * @param users - The users' repository.
 * @param sessions - The sessions, if any.
 * @param audit - The audit log.
 * @returns The password accounts, or `undefined`.
 */
function passwordAccounts(
  dependencies: AccountDependencies,
  users: UserRepository,
  sessions: Sessions | undefined,
  audit: Audit,
): PasswordAccounts | undefined {
  const { sessionHashes, peppers, now } = dependencies;
  if (!sessionHashes || !peppers || !sessions) return undefined;
  return createPasswordAccounts({
    users,
    sessions,
    audit,
    secretBox: dependencies.secretBox,
    emailIndex: dependencies.emailIndex,
    links: createPasswordLinkRepository(dependencies.database),
    tokenHash: sessionHashes.tokenHash,
    peppers,
    addresses: createThrottle(addressRule, now),
    accounts: createThrottle(accountRule, now),
    ...(dependencies.passwordCosts ? { costs: dependencies.passwordCosts } : {}),
    ...(now ? { now } : {}),
  });
}

/**
 * Whether a user can sign in: with a password while passwords are on, or through a provider that
 * is on.
 *
 * @param settings - The sign-in settings.
 * @param identities - The linked identities.
 * @returns The check.
 */
function signInCheck(settings: SignInSettings, identities: IdentityRepository) {
  return (row: UserRow): boolean => {
    if (row.passwordHash !== null && settings.passwordSignIn()) return true;
    const enabled = new Set(
      settings
        .view()
        .providers.filter((provider) => provider.enabled)
        .map((provider) => provider.id),
    );
    return identities.listOf(row.id).some((identity) => enabled.has(identity.providerId));
  };
}

/**
 * Provider sign-ins, when querent has a public URL and sessions.
 *
 * @param dependencies - The account dependencies.
 * @param parts - The services the flows use.
 * @returns The flows, or `undefined`.
 */
function providerFlows(
  dependencies: AccountDependencies,
  parts: Pick<Accounts, 'users' | 'userRows' | 'sessions' | 'signInSettings' | 'identityRows'> & {
    audit: Audit;
  },
): ProviderFlows | undefined {
  const { publicUrl } = dependencies;
  if (!publicUrl || !parts.sessions) return undefined;
  return createProviderFlows({
    settings: parts.signInSettings,
    secretBox: dependencies.secretBox,
    lookupIndex: dependencies.emailIndex,
    identities: parts.identityRows,
    userRows: parts.userRows,
    users: parts.users,
    sessions: parts.sessions,
    audit: parts.audit,
    publicUrl,
    ...(dependencies.driverOptions ? { driverOptions: dependencies.driverOptions } : {}),
    ...(dependencies.now ? { now: dependencies.now } : {}),
  });
}

/**
 * The authentication mode.
 *
 * @param dependencies - The account dependencies.
 * @param parts - The services it reads.
 * @returns The mode control.
 */
function modeControl(
  dependencies: AccountDependencies,
  parts: Pick<Accounts, 'users' | 'userRows' | 'sessions' | 'signInSettings' | 'identityRows'> & {
    audit: Audit;
  },
): AuthModeControl {
  return createAuthModeControl({
    settings: dependencies.settings,
    override: dependencies.authOverride,
    problems: dependencies.accountsProblems ?? [],
    users: parts.userRows,
    names: parts.users,
    canSignIn: signInCheck(parts.signInSettings, parts.identityRows),
    threads: createThreadOwnershipRepository(dependencies.database),
    sessions: parts.sessions,
    audit: parts.audit,
  });
}

/**
 * The sign-in settings, and one's own linked providers.
 *
 * @param dependencies - The account dependencies.
 * @param stores - The users' and identities' repositories, and the audit log.
 * @returns The two services.
 */
function signInParts(
  dependencies: AccountDependencies,
  stores: { userRows: UserRepository; identityRows: IdentityRepository; audit: Audit },
): Pick<Accounts, 'signInSettings' | 'linkedIdentities'> {
  const { userRows: users, identityRows: identities, audit } = stores;
  const signInSettings = createSignInSettings({
    store: dependencies.settings,
    secretBox: dependencies.secretBox,
    identities,
    users,
    publicUrl: dependencies.publicUrl,
    audit,
    ...(dependencies.now ? { now: dependencies.now } : {}),
  });
  const linkedIdentities = createLinkedIdentities({
    settings: signInSettings,
    identities,
    users,
    audit,
  });
  return { signInSettings, linkedIdentities };
}

/**
 * Creates the account services.
 *
 * @param dependencies - The database, keys, settings, public URL and clock.
 * @param audit - The audit log.
 * @returns The services.
 */
export function createAccounts(dependencies: AccountDependencies, audit: Audit): Accounts {
  const { database, secretBox, emailIndex, sessionHashes, now } = dependencies;
  const clock = now ? { now } : {};
  const userRows = createUserRepository(database);
  const identityRows = createIdentityRepository(database);
  const users = createUsers({ repository: userRows, secretBox, emailIndex, audit, ...clock });
  const sessions =
    sessionHashes &&
    createSessions({ repository: createSessionRepository(database), ...sessionHashes, ...clock });
  const { signInSettings, linkedIdentities } = signInParts(dependencies, {
    userRows,
    identityRows,
    audit,
  });
  const parts = { users, userRows, sessions, signInSettings, identityRows, audit };
  return {
    ...parts,
    linkedIdentities,
    passwords: passwordAccounts(dependencies, userRows, sessions, audit),
    userAdmin: { repository: userRows, sessions, audit, ...clock },
    authMode: modeControl(dependencies, parts),
    flows: providerFlows(dependencies, parts),
  };
}
