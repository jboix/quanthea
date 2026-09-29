/**
 * Signing in with a password, setting one through a link, and changing it. Every failure answers
 * the same "Wrong email or password." after the same argon2id work, whether the account exists or
 * not, and counts against the IP address and the account (`throttle.ts`). A link is checked before
 * it is used, and used once.
 */
import type { AuditRepository } from '../db/audit-repository.ts';
import type { LinkPurpose, PasswordLinkRepository } from '../db/password-link-repository.ts';
import type { UserRepository, UserRow } from '../db/user-repository.ts';
import { AppError } from '../lib/errors.ts';
import type { KeyedHash } from '../secrets/keyed-hash.ts';
import { randomToken } from '../secrets/keyed-hash.ts';
import type { Peppers } from '../secrets/keys.ts';
import type { SecretBox } from '../secrets/secret-box.ts';
import {
  defaultCosts,
  type HashCosts,
  hashPassword,
  needsRehash,
  passwordProblem,
  verifyPassword,
} from './passwords.ts';
import type { Sessions } from './sessions.ts';
import type { Throttle } from './throttle.ts';
import { normalizeEmail, sealedOwner } from './users.ts';

/** How long an invite link works. */
export const inviteLifetimeMs = 72 * 3_600_000;

/** How long a reset link works. */
export const resetLifetimeMs = 24 * 3_600_000;

/** The one answer to every failed sign-in. */
const wrongCredentials = 'Wrong email or password.';

/** What password accounts need. */
export interface PasswordAccountsDependencies {
  /** Stores users. */
  readonly users: UserRepository;
  /** Opens names and emails, for the password policy. */
  readonly secretBox: SecretBox;
  /** Indexes emails. */
  readonly emailIndex: KeyedHash;
  /** Stores links. */
  readonly links: PasswordLinkRepository;
  /** Hashes link tokens. */
  readonly tokenHash: KeyedHash;
  /** The peppers. */
  readonly peppers: Peppers;
  /** Starts and ends sessions. */
  readonly sessions: Sessions;
  /** Throttles failures by IP address. */
  readonly addresses: Throttle;
  /** Throttles failures by account. */
  readonly accounts: Throttle;
  /** Records who did what. */
  readonly audit: AuditRepository;
  /** The argon2id costs; lower in tests only. */
  readonly costs?: HashCosts;
  /** The clock; `Date.now` by default. */
  readonly now?: () => number;
}

/** A signed-in person: the session cookie, and who they are. */
export interface SignedIn {
  /** The session cookie's value. */
  readonly cookie: string;
  /** The user. */
  readonly userId: string;
}

/** Password accounts. */
export interface PasswordAccounts {
  /**
   * Signs in with an email and a password.
   *
   * @param input - The email, the password and the IP address.
   * @returns The session.
   * @throws {AppError} `unauthorized` for any wrong detail; `rate_limited` while throttled.
   */
  signIn(input: { email: string; password: string; address: string }): Promise<SignedIn>;
  /**
   * Makes a link that sets a user's password; it replaces the user's earlier links.
   *
   * @param userId - The user.
   * @param purpose - An invite or a reset.
   * @param actor - Who makes it.
   * @returns The token, to put after `#` in the link, and when it stops working.
   */
  issueLink(
    userId: string,
    purpose: LinkPurpose,
    actor: string,
  ): Promise<{ token: string; expiresAt: number }>;
  /**
   * Sets a password through a link, ends the user's other sessions, and signs them in.
   *
   * @param input - The link's token, the new password and the IP address.
   * @returns The session.
   * @throws {AppError} `bad_request` for a used, expired or unknown link, or a refused password.
   */
  setWithLink(input: { token: string; password: string; address: string }): Promise<SignedIn>;
  /**
   * Changes a signed-in user's password, ends all their sessions, and starts a new one.
   *
   * @param input - The user, their current password and the new one.
   * @returns The new session.
   * @throws {AppError} `bad_request` for a wrong current password or a refused new one.
   */
  change(input: { userId: string; current: string; password: string }): Promise<SignedIn>;
}

/** The dependencies with the clock and costs resolved. */
type Context = PasswordAccountsDependencies & {
  readonly now: () => number;
  readonly costs: HashCosts;
  /** A hash no password matches, verified when there is no account, so every failure costs the same. */
  readonly dummy: Promise<{ hash: string; pepperId: string }>;
};

/**
 * Refuses a throttled attempt.
 *
 * @param keys - The throttles and their keys.
 * @throws {AppError} `rate_limited` when any of them must still wait.
 */
function refuseWhileThrottled(keys: readonly [Throttle, string][]): void {
  const waitMs = Math.max(...keys.map(([throttle, key]) => throttle.waitFor(key)));
  if (waitMs <= 0) return;
  const minutes = Math.ceil(waitMs / 60_000);
  throw new AppError(
    'rate_limited',
    `Too many attempts. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`,
  );
}

/**
 * Whether a password is right for a user, doing the same work when there is no usable account.
 *
 * @param context - The context.
 * @param row - The user, if any.
 * @param password - The password.
 * @returns Whether it is right.
 */
async function passwordMatches(
  context: Context,
  row: UserRow | undefined,
  password: string,
): Promise<boolean> {
  const usable =
    row && row.disabledAt === null && row.passwordHash !== null && row.pepperId !== null;
  if (!usable || !row.passwordHash || !row.pepperId) {
    await verifyPassword(context.peppers, password, await context.dummy);
    return false;
  }
  return verifyPassword(context.peppers, password, {
    hash: row.passwordHash,
    pepperId: row.pepperId,
  });
}

/**
 * Stores a new password hash for a user.
 *
 * @param context - The context.
 * @param userId - The user.
 * @param password - The password.
 */
async function storePassword(context: Context, userId: string, password: string): Promise<void> {
  const stored = await hashPassword(context.peppers, password, context.costs);
  context.users.update(userId, {
    passwordHash: stored.hash,
    pepperId: stored.pepperId,
    updatedAt: context.now(),
  });
}

/**
 * Signs in with an email and a password.
 *
 * @param context - The context.
 * @param input - The email, the password and the IP address.
 * @returns The session.
 */
async function signIn(
  context: Context,
  input: { email: string; password: string; address: string },
): Promise<SignedIn> {
  const index = await context.emailIndex.hash(normalizeEmail(input.email));
  const account = Buffer.from(index).toString('hex');
  refuseWhileThrottled([
    [context.addresses, input.address],
    [context.accounts, account],
  ]);
  const row = context.users.findByEmailIndex(index);
  if (!(await passwordMatches(context, row, input.password)) || !row) {
    context.addresses.fail(input.address);
    context.accounts.fail(account);
    const detail = { account: account.slice(0, 12) };
    context.audit.append({ actor: row?.id ?? 'unknown', action: 'auth.sign-in-failed', detail });
    throw new AppError('unauthorized', wrongCredentials);
  }
  context.accounts.forget(account);
  return completeSignIn(context, row, input.password);
}

/**
 * Finishes a sign-in: makes the hash again when due, records it, and starts a session.
 *
 * @param context - The context.
 * @param row - The user.
 * @param password - The right password.
 * @returns The session.
 */
async function completeSignIn(context: Context, row: UserRow, password: string): Promise<SignedIn> {
  const stored = { hash: row.passwordHash ?? '', pepperId: row.pepperId ?? '' };
  if (needsRehash(context.peppers, stored, context.costs))
    await storePassword(context, row.id, password);
  context.users.update(row.id, { lastSignInAt: context.now(), updatedAt: context.now() });
  const { cookie } = await context.sessions.start(row.id);
  context.audit.append({ actor: row.id, action: 'auth.sign-in', detail: { method: 'password' } });
  return { cookie, userId: row.id };
}

/**
 * Why a new password is refused for a user.
 *
 * @param context - The context.
 * @param row - The user.
 * @param password - The new password.
 * @throws {AppError} `bad_request` with the reason.
 */
async function refuseWeakPassword(context: Context, row: UserRow, password: string): Promise<void> {
  const email = await context.secretBox.open(row.emailSealed, sealedOwner(row.id, 'email'));
  const name = await context.secretBox.open(row.nameSealed, sealedOwner(row.id, 'name'));
  const problem = passwordProblem(password, { email, name });
  if (problem)
    throw new AppError('bad_request', problem, [
      { part: 'body', path: 'password', message: problem },
    ]);
}

/**
 * Sets a password through a link.
 *
 * @param context - The context.
 * @param input - The token, the new password and the IP address.
 * @returns The session.
 */
async function setWithLink(
  context: Context,
  input: { token: string; password: string; address: string },
): Promise<SignedIn> {
  refuseWhileThrottled([[context.addresses, input.address]]);
  const hash = await context.tokenHash.hash(input.token);
  const link = context.links.find(hash);
  const row = link && context.users.get(link.userId);
  if (!link || !row || link.expiresAt <= context.now() || row.disabledAt !== null) {
    context.addresses.fail(input.address);
    throw new AppError(
      'bad_request',
      'This link has expired or was used. Ask an admin for a new one.',
    );
  }
  await refuseWeakPassword(context, row, input.password);
  if (!context.links.take(hash)) throw new AppError('bad_request', 'This link was used just now.');
  await storePassword(context, row.id, input.password);
  context.sessions.endAllOf(row.id);
  context.audit.append({
    actor: row.id,
    action: 'user.password-set',
    detail: { purpose: link.purpose },
  });
  return completeSignIn(context, context.users.get(row.id) ?? row, input.password);
}

/**
 * Changes a signed-in user's password.
 *
 * @param context - The context.
 * @param input - The user, the current password and the new one.
 * @returns The new session.
 */
async function change(
  context: Context,
  input: { userId: string; current: string; password: string },
): Promise<SignedIn> {
  refuseWhileThrottled([[context.accounts, input.userId]]);
  const row = context.users.get(input.userId);
  if (!row || !(await passwordMatches(context, row, input.current))) {
    context.accounts.fail(input.userId);
    throw new AppError('bad_request', 'The current password is wrong.', [
      { part: 'body', path: 'current', message: 'The current password is wrong.' },
    ]);
  }
  await refuseWeakPassword(context, row, input.password);
  await storePassword(context, row.id, input.password);
  context.sessions.endAllOf(row.id);
  context.audit.append({ actor: row.id, action: 'user.password-change' });
  const { cookie } = await context.sessions.start(row.id);
  return { cookie, userId: row.id };
}

/**
 * Creates password accounts.
 *
 * @param dependencies - The users, links, keys, sessions, throttles, audit log, costs and clock.
 * @returns The service.
 */
export function createPasswordAccounts(
  dependencies: PasswordAccountsDependencies,
): PasswordAccounts {
  const costs = dependencies.costs ?? defaultCosts;
  const dummy = hashPassword(dependencies.peppers, randomToken(), costs);
  const context: Context = { ...dependencies, now: dependencies.now ?? Date.now, costs, dummy };
  return {
    signIn: (input) => signIn(context, input),
    issueLink: async (userId, purpose, actor) => {
      const token = randomToken();
      const at = context.now();
      const expiresAt = at + (purpose === 'invite' ? inviteLifetimeMs : resetLifetimeMs);
      const tokenHash = await context.tokenHash.hash(token);
      context.links.replace({
        tokenHash,
        userId,
        purpose,
        expiresAt,
        createdBy: actor,
        createdAt: at,
      });
      context.audit.append({ actor, action: `user.${purpose}-link`, target: userId });
      return { token, expiresAt };
    },
    setWithLink: (input) => setWithLink(context, input),
    change: (input) => change(context, input),
  };
}
