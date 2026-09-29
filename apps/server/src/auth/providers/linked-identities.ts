/**
 * One's own linked providers: which are linked, which may be, and unlinking one while another way
 * to sign in remains.
 */
import type { AuditRepository } from '../../db/audit-repository.ts';
import type { IdentityRepository } from '../../db/identity-repository.ts';
import type { UserRepository } from '../../db/user-repository.ts';
import { AppError } from '../../lib/errors.ts';
import type { SignInSettings } from './sign-in-settings.ts';

/** A provider that is on, as the login page and the account menu list it. */
export interface EnabledProvider {
  /** Its id. */
  readonly id: string;
  /** The name on its button. */
  readonly name: string;
  /** Its kind. */
  readonly kind: ReturnType<SignInSettings['view']>['providers'][number]['kind'];
}

/** A person's providers. */
export interface PersonIdentities {
  /** The providers linked to them. */
  readonly linked: { providerId: string; name: string; linkedAt: number }[];
  /** The providers that are on, which they may link. */
  readonly available: EnabledProvider[];
  /** Whether they have a password. */
  readonly hasPassword: boolean;
}

/** One's own linked providers. */
export interface LinkedIdentities {
  /**
   * The providers that are on.
   *
   * @returns Their ids, names and kinds.
   */
  enabledProviders(): EnabledProvider[];
  /**
   * A person's providers.
   *
   * @param userId - The person.
   * @returns Their linked providers, those they may link, and whether they have a password.
   */
  of(userId: string): PersonIdentities;
  /**
   * Unlinks a provider from a person.
   *
   * @param userId - The person.
   * @param providerId - The provider.
   * @returns How many identities were unlinked.
   * @throws {AppError} `bad_request` when it is their last way to sign in.
   */
  unlink(userId: string, providerId: string): number;
}

/** What {@link createLinkedIdentities} needs. */
export interface LinkedIdentitiesDependencies {
  /** The sign-in settings. */
  readonly settings: SignInSettings;
  /** The linked identities. */
  readonly identities: IdentityRepository;
  /** The users, for whether one has a password. */
  readonly users: UserRepository;
  /** Records who did what. */
  readonly audit: AuditRepository;
}

/**
 * The providers that are on.
 *
 * @param settings - The sign-in settings.
 * @returns Their ids, names and kinds.
 */
function enabledOf(settings: SignInSettings): EnabledProvider[] {
  return settings
    .view()
    .providers.filter((provider) => provider.enabled)
    .map(({ id, name, kind }) => ({ id, name, kind }));
}

/**
 * A person's providers.
 *
 * @param dependencies - The settings, identities and users.
 * @param userId - The person.
 * @returns Their providers.
 */
function identitiesOf(dependencies: LinkedIdentitiesDependencies, userId: string) {
  const { settings, identities, users } = dependencies;
  const names = new Map(settings.view().providers.map((provider) => [provider.id, provider.name]));
  const linked = identities.listOf(userId).map((identity) => ({
    providerId: identity.providerId,
    name: names.get(identity.providerId) ?? identity.providerId,
    linkedAt: identity.createdAt,
  }));
  const hasPassword = users.get(userId)?.passwordHash != null;
  return { linked, available: enabledOf(settings), hasPassword };
}

/**
 * Unlinks a provider, unless it is the person's last way to sign in.
 *
 * @param dependencies - The settings, identities, users and audit log.
 * @param userId - The person.
 * @param providerId - The provider.
 * @returns How many identities were unlinked.
 * @throws {AppError} `bad_request` when it is their last way to sign in.
 */
function unlink(dependencies: LinkedIdentitiesDependencies, userId: string, providerId: string) {
  const { settings, identities, users } = dependencies;
  const others = identities.listOf(userId).filter((each) => each.providerId !== providerId);
  const password = users.get(userId)?.passwordHash != null && settings.passwordSignIn();
  if (others.length === 0 && !password)
    throw new AppError('bad_request', 'This is your only way to sign in. Link another first.');
  const unlinked = identities.unlink(userId, providerId);
  if (unlinked > 0)
    dependencies.audit.append({ actor: userId, action: 'identity.unlinked', target: providerId });
  return unlinked;
}

/**
 * Creates one's own linked providers.
 *
 * @param dependencies - The settings, identities, users and audit log.
 * @returns The methods.
 */
export function createLinkedIdentities(
  dependencies: LinkedIdentitiesDependencies,
): LinkedIdentities {
  return {
    enabledProviders: () => enabledOf(dependencies.settings),
    of: (userId) => identitiesOf(dependencies, userId),
    unlink: (userId, providerId) => unlink(dependencies, userId, providerId),
  };
}
