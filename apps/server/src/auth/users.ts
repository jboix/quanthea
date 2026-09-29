/**
 * The people who sign in. Names and emails are sealed with the secret key, each bound to its user;
 * an email is found through a keyed hash of its normalised form, so the database holds no readable
 * email. The audit log names users by id only.
 */
import type { Principal, Role } from '@querent/shared';
import type { AuditRepository } from '../db/audit-repository.ts';
import type { UserRepository, UserRow } from '../db/user-repository.ts';
import { AppError } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import type { KeyedHash } from '../secrets/keyed-hash.ts';
import type { SecretBox } from '../secrets/secret-box.ts';

/** A user as the server works with it, opened. */
export interface User {
  /** The id. */
  readonly id: string;
  /** The email, as typed when the user was created. */
  readonly email: string;
  /** The name shown in the app. */
  readonly name: string;
  /** The role. */
  readonly role: Role;
  /** Whether the user may no longer sign in. */
  readonly disabled: boolean;
  /** Whether a password is set. */
  readonly hasPassword: boolean;
  /** The last sign-in. */
  readonly lastSignInAt: number | null;
  /** Creation time. */
  readonly createdAt: number;
}

/** What the users service needs. */
export interface UsersDependencies {
  /** Stores users. */
  readonly repository: UserRepository;
  /** Seals names and emails. */
  readonly secretBox: SecretBox;
  /** The keyed hash that indexes emails. */
  readonly emailIndex: KeyedHash;
  /** Records who did what. */
  readonly audit: AuditRepository;
  /** The clock; `Date.now` by default. */
  readonly now?: () => number;
}

/** The people who sign in. */
export interface Users {
  /**
   * Creates a user with no password yet.
   *
   * @param input - The email, the name and the role.
   * @param actor - Who creates the user.
   * @returns The user.
   * @throws {AppError} `bad_request` when a user has this email.
   */
  create(input: { email: string; name: string; role: Role }, actor: string): Promise<User>;
  /**
   * Finds a user.
   *
   * @param id - The user id.
   * @returns The user.
   * @throws {AppError} `not_found`.
   */
  get(id: string): Promise<User>;
  /**
   * Finds a user by email, whatever its case and spacing.
   *
   * @param email - The email.
   * @returns The stored user, or `undefined`.
   */
  findByEmail(email: string): Promise<UserRow | undefined>;
  /**
   * Lists every user, the oldest first.
   *
   * @returns The users.
   */
  list(): Promise<User[]>;
  /**
   * A user's name, also when they are disabled.
   *
   * @param id - The user id.
   * @returns The name, or `undefined` when there is no such user.
   */
  nameOf(id: string): Promise<string | undefined>;
  /**
   * Who a request acts as, for a signed-in user.
   *
   * @param id - The user id.
   * @returns The principal, or `null` when the user is gone or disabled.
   */
  principalOf(id: string): Promise<Principal | null>;
}

/**
 * The form of an email that finds it: trimmed, Unicode-normalised, lowercase.
 *
 * @param email - The email.
 * @returns The normalised email.
 */
export function normalizeEmail(email: string): string {
  return email.trim().normalize('NFKC').toLowerCase();
}

/**
 * What a sealed field of a user is bound to, so it opens only on its own row.
 *
 * @param id - The user id.
 * @param field - The field.
 * @returns The owner string.
 */
export function sealedOwner(id: string, field: 'email' | 'name'): string {
  return `users.${field}.${id}`;
}

/**
 * Opens a stored user.
 *
 * @param secretBox - The secret box.
 * @param row - The stored user.
 * @returns The user.
 */
async function openUser(secretBox: SecretBox, row: UserRow): Promise<User> {
  return {
    id: row.id,
    email: await secretBox.open(row.emailSealed, sealedOwner(row.id, 'email')),
    name: await secretBox.open(row.nameSealed, sealedOwner(row.id, 'name')),
    role: row.role,
    disabled: row.disabledAt !== null,
    hasPassword: row.passwordHash !== null,
    lastSignInAt: row.lastSignInAt,
    createdAt: row.createdAt,
  };
}

/**
 * Creates a user.
 *
 * @param dependencies - The users service's dependencies.
 * @param input - The email, the name and the role.
 * @param actor - Who creates the user.
 * @returns The user.
 * @throws {AppError} `bad_request` when a user has this email.
 */
async function createUser(
  dependencies: UsersDependencies,
  input: { email: string; name: string; role: Role },
  actor: string,
): Promise<User> {
  const { repository, secretBox, emailIndex, audit } = dependencies;
  const id = newId();
  const at = (dependencies.now ?? Date.now)();
  const email = input.email.trim();
  const row: UserRow = {
    id,
    emailIndex: await emailIndex.hash(normalizeEmail(email)),
    emailSealed: await secretBox.seal(email, sealedOwner(id, 'email')),
    nameSealed: await secretBox.seal(input.name.trim(), sealedOwner(id, 'name')),
    role: input.role,
    passwordHash: null,
    pepperId: null,
    disabledAt: null,
    lastSignInAt: null,
    createdAt: at,
    updatedAt: at,
  };
  if (!repository.create(row)) throw new AppError('bad_request', 'A user has this email already.');
  audit.append({ actor, action: 'user.create', target: id, detail: { role: input.role } });
  return openUser(secretBox, row);
}

/**
 * Creates the users service.
 *
 * @param dependencies - The repository, the secret box, the email index, the audit log and the
 *   clock.
 * @returns The service.
 */
export function createUsers(dependencies: UsersDependencies): Users {
  const { repository, secretBox, emailIndex } = dependencies;
  return {
    create: (input, actor) => createUser(dependencies, input, actor),
    get: async (id) => {
      const row = repository.get(id);
      if (!row) throw new AppError('not_found', `No user ${id}.`);
      return openUser(secretBox, row);
    },
    findByEmail: async (email) =>
      repository.findByEmailIndex(await emailIndex.hash(normalizeEmail(email))),
    list: () => Promise.all(repository.list().map((row) => openUser(secretBox, row))),
    nameOf: async (id) => {
      const row = repository.get(id);
      return row && secretBox.open(row.nameSealed, sealedOwner(id, 'name'));
    },
    principalOf: async (id) => {
      const row = repository.get(id);
      if (!row || row.disabledAt !== null) return null;
      const name = await secretBox.open(row.nameSealed, sealedOwner(id, 'name'));
      return { id, name, role: row.role };
    },
  };
}
