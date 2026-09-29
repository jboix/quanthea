/**
 * Password hashes. A password first goes through an HMAC under the pepper, a key that never
 * reaches the database, then argon2id (64 MiB, 3 passes). A copy of the database alone cannot be
 * attacked offline: without the pepper, no guess can be checked. A hash made with other costs or
 * the previous pepper is made again at the next sign-in.
 */
import type { Pepper, Peppers } from '../secrets/keys.ts';

/** The argon2id costs: memory in KiB, and passes. */
export interface HashCosts {
  /** Memory, in kibibytes. */
  readonly memoryCost: number;
  /** Passes over the memory. */
  readonly timeCost: number;
}

/** The costs of new hashes: 64 MiB and 3 passes, above OWASP's minimum for argon2id. */
export const defaultCosts: HashCosts = { memoryCost: 65_536, timeCost: 3 };

/** The shortest password accepted. */
export const minimumLength = 12;

/** The longest password accepted, in characters. */
export const maximumLength = 256;

/** A password hash and the pepper it was made with. */
export interface StoredHash {
  /** The argon2id hash, in PHC form. */
  readonly hash: string;
  /** The pepper's id. */
  readonly pepperId: string;
}

/**
 * Well-known long passwords, lowercase. Short ones are refused by length already.
 */
const commonPasswords = new Set([
  'password1234',
  'password12345',
  'password123456',
  'passwordpassword',
  'qwertyuiopasdfgh',
  'qwertyuiop123',
  'qwerty123456',
  '123456789012',
  '1234567890123',
  '12345678901234',
  '123456789abc',
  'abcdefghijkl',
  'iloveyou1234',
  'letmein12345',
  'welcome12345',
  'administrator',
  'changeme1234',
  'querent12345',
  'correcthorsebatterystaple',
  '111111111111',
  '000000000000',
  'aaaaaaaaaaaa',
]);

/**
 * The pepper's HMAC of a password, the value argon2id hashes.
 *
 * @param pepper - The pepper.
 * @param password - The password.
 * @returns The HMAC, in base64.
 */
async function peppered(pepper: Pepper, password: string): Promise<string> {
  return Buffer.from(await pepper.hash.hash(password)).toString('base64');
}

/**
 * Hashes a password with the current pepper.
 *
 * @param peppers - The peppers.
 * @param password - The password.
 * @param costs - The argon2id costs.
 * @returns The hash and the pepper's id.
 */
export async function hashPassword(
  peppers: Peppers,
  password: string,
  costs: HashCosts = defaultCosts,
): Promise<StoredHash> {
  const hash = await Bun.password.hash(await peppered(peppers.current, password), {
    algorithm: 'argon2id',
    ...costs,
  });
  return { hash, pepperId: peppers.current.id };
}

/**
 * Whether a password matches a stored hash, with the pepper it was made with.
 *
 * @param peppers - The peppers.
 * @param password - The password.
 * @param stored - The stored hash.
 * @returns Whether it matches; `false` when the pepper that made it is gone.
 */
export async function verifyPassword(
  peppers: Peppers,
  password: string,
  stored: StoredHash,
): Promise<boolean> {
  const pepper = [peppers.current, peppers.previous].find((each) => each?.id === stored.pepperId);
  if (!pepper) return false;
  return Bun.password.verify(await peppered(pepper, password), stored.hash, 'argon2id');
}

/**
 * Whether a hash should be made again: other costs, or the previous pepper.
 *
 * @param peppers - The peppers.
 * @param stored - The stored hash.
 * @param costs - The costs of new hashes.
 * @returns Whether to hash again.
 */
export function needsRehash(
  peppers: Peppers,
  stored: StoredHash,
  costs: HashCosts = defaultCosts,
): boolean {
  if (stored.pepperId !== peppers.current.id) return true;
  const match = /\$argon2id\$v=19\$m=(\d+),t=(\d+),p=\d+\$/.exec(stored.hash);
  return !match || Number(match[1]) !== costs.memoryCost || Number(match[2]) !== costs.timeCost;
}

/**
 * Why a new password is refused, if it is: too short or long, too few distinct characters, a
 * well-known one, or the person's email or name.
 *
 * @param password - The new password.
 * @param person - The person's email and name.
 * @param person.email - Their email.
 * @param person.name - Their name.
 * @returns The reason, or `undefined` when the password is accepted.
 */
export function passwordProblem(
  password: string,
  person: { readonly email: string; readonly name: string },
): string | undefined {
  const length = [...password].length;
  if (length < minimumLength) return `Use at least ${minimumLength} characters.`;
  if (length > maximumLength) return `Use at most ${maximumLength} characters.`;
  const lower = password.toLowerCase();
  if (new Set(lower).size < 5 || commonPasswords.has(lower))
    return 'This password is too easy to guess.';
  if (containsPerson(lower, person)) return 'Do not use your name or email in your password.';
  return undefined;
}

/**
 * Whether a password holds the person's name or the part of their email before the `@`.
 *
 * @param lower - The password, lowercase.
 * @param person - The person's email and name.
 * @param person.email - Their email.
 * @param person.name - Their name.
 * @returns Whether it does, for parts of four characters or more.
 */
function containsPerson(
  lower: string,
  person: { readonly email: string; readonly name: string },
): boolean {
  const parts = [person.email.split('@')[0] ?? '', person.name.replaceAll(' ', '')];
  return parts.some((part) => part.length >= 4 && lower.includes(part.toLowerCase()));
}
