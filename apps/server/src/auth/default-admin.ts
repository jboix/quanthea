/**
 * The default admin. On a start with no enabled admin, querent creates the user `admin` with a
 * random password written once to the log, as Jenkins or Argo CD do; nobody can guess it on a
 * freshly exposed install. Until that admin chooses their own email and password, every other
 * route refuses them.
 */
import { randomInt } from 'node:crypto';
import type { AuditRepository } from '../db/audit-repository.ts';
import type { UserRepository } from '../db/user-repository.ts';
import { AppError } from '../lib/errors.ts';
import type { Logger } from '../lib/logger.ts';
import type { KeyedHash } from '../secrets/keyed-hash.ts';
import type { Peppers } from '../secrets/keys.ts';
import type { SecretBox } from '../secrets/secret-box.ts';
import type { SignedIn } from './password-accounts.ts';
import { type HashCosts, hashPassword, passwordProblem } from './passwords.ts';
import type { Sessions } from './sessions.ts';
import { normalizeEmail, sealedOwner, type Users } from './users.ts';

/** The sign-in name of the default admin, until they choose an email. */
export const defaultAdminLogin = 'admin';

/** Characters of a generated password: no look-alikes such as 0 and O, or 1 and l. */
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** What the default admin needs. */
export interface DefaultAdminDependencies {
  /** The users. */
  readonly users: Users;
  /** Users as stored. */
  readonly userRows: UserRepository;
  /** Seals the admin's email and name. */
  readonly secretBox: SecretBox;
  /** Indexes emails. */
  readonly emailIndex: KeyedHash;
  /** The peppers. */
  readonly peppers: Peppers;
  /** Starts and ends sessions. */
  readonly sessions: Sessions;
  /** Records who did what. */
  readonly audit: AuditRepository;
  /** The argon2id costs; lower in tests only. */
  readonly costs?: HashCosts;
  /** The clock; `Date.now` by default. */
  readonly now?: () => number;
}

/** Password length: 24 characters of the alphabet, about 140 bits. */
const passwordLength = 24;

/**
 * A random password of 24 characters, about 140 bits. `randomInt` draws each character from the
 * whole alphabet without bias.
 *
 * @returns The password.
 */
export function generatedPassword(): string {
  return Array.from({ length: passwordLength }, () => alphabet[randomInt(alphabet.length)]).join(
    '',
  );
}

/**
 * The oldest enabled admin, if any.
 *
 * @param rows - The users.
 * @returns The admin's id.
 */
function firstAdmin(rows: UserRepository): string | undefined {
  return rows.list().find((row) => row.role === 'admin' && row.disabledAt === null)?.id;
}

/**
 * Creates the default admin, or gives the existing `admin` user a new password, and asks them
 * to set up their account at the first sign-in.
 *
 * @param dependencies - The users, the keys and the audit log.
 * @returns The admin's id and password.
 */
async function createDefaultAdmin(dependencies: DefaultAdminDependencies) {
  const { users, userRows, peppers } = dependencies;
  const existing = await users.findByEmail(defaultAdminLogin);
  const id =
    existing?.id ??
    (await users.create({ email: defaultAdminLogin, name: 'Admin', role: 'admin' }, 'querent')).id;
  const password = generatedPassword();
  const stored = await hashPassword(peppers, password, dependencies.costs);
  const at = (dependencies.now ?? Date.now)();
  userRows.update(id, {
    role: 'admin',
    disabledAt: null,
    passwordHash: stored.hash,
    pepperId: stored.pepperId,
    setupRequired: true,
    updatedAt: at,
  });
  dependencies.audit.append({ actor: 'querent', action: 'user.default-admin', target: id });
  return { id, password };
}

/**
 * Makes sure an admin exists: creates the default one when no enabled admin does.
 *
 * @param dependencies - The users, the keys and the audit log.
 * @param logger - Receives the default admin's password, once.
 * @returns Once it is done.
 */
export async function ensureAdmin(
  dependencies: DefaultAdminDependencies,
  logger: Logger,
): Promise<void> {
  if (!firstAdmin(dependencies.userRows)) {
    const { password } = await createDefaultAdmin(dependencies);
    logger.warn(
      `Created the admin. Sign in as "${defaultAdminLogin}" with the password below, then choose your own email and password.`,
      { password },
    );
  }
}

/** What setting up the default admin's account takes. */
export interface SetupInput {
  /** The admin. */
  readonly userId: string;
  /** Their email. */
  readonly email: string;
  /** Their name. */
  readonly name: string;
  /** Their password. */
  readonly password: string;
}

/**
 * Refuses an email another user has, and a weak password.
 *
 * @param dependencies - The users.
 * @param input - The admin's choices.
 * @throws {AppError} `bad_request` naming the field.
 */
async function refuseSetup(dependencies: DefaultAdminDependencies, input: SetupInput) {
  const other = await dependencies.users.findByEmail(input.email);
  if (other && other.id !== input.userId)
    throw new AppError('bad_request', 'A user has this email already.', [
      { part: 'body', path: 'email', message: 'A user has this email already.' },
    ]);
  const problem = passwordProblem(input.password, input);
  if (problem)
    throw new AppError('bad_request', problem, [
      { part: 'body', path: 'password', message: problem },
    ]);
}

/**
 * Sets up the default admin's account: their email, name and password. Their other sessions end.
 *
 * @param dependencies - The users, the keys and the sessions.
 * @param input - The admin's choices.
 * @returns A new session.
 * @throws {AppError} `bad_request` when there is nothing to set up, or a choice is refused.
 */
export async function completeSetup(
  dependencies: DefaultAdminDependencies,
  input: SetupInput,
): Promise<SignedIn> {
  const { userRows, secretBox, userId } = { ...dependencies, userId: input.userId };
  if (!userRows.get(userId)?.setupRequired)
    throw new AppError('bad_request', 'This account is set up already.');
  await refuseSetup(dependencies, input);
  const email = input.email.trim();
  const stored = await hashPassword(dependencies.peppers, input.password, dependencies.costs);
  userRows.update(userId, {
    emailIndex: await dependencies.emailIndex.hash(normalizeEmail(email)),
    emailSealed: await secretBox.seal(email, sealedOwner(userId, 'email')),
    nameSealed: await secretBox.seal(input.name.trim(), sealedOwner(userId, 'name')),
    passwordHash: stored.hash,
    pepperId: stored.pepperId,
    setupRequired: false,
    updatedAt: (dependencies.now ?? Date.now)(),
  });
  dependencies.sessions.endAllOf(userId);
  dependencies.audit.append({ actor: userId, action: 'user.setup', target: userId });
  const { cookie } = await dependencies.sessions.start(userId);
  return { cookie, userId };
}
