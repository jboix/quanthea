/**
 * Users in the configuration file, keyed by email: their name, role, and whether they are
 * disabled. A user the file declares starts invited; they sign in through a provider with that
 * verified email, or with a password the file gives while they have none. The key `admin` is the
 * admin who signs in as `admin`, with no email, and needs a password:
 *
 * ```yaml
 * users:
 *   admin: { password: "${ADMIN_PASSWORD}" }
 *   ada@example.com: { name: Ada Lovelace, role: editor }
 * ```
 *
 * The record of what the file manages names a user by the keyed hash of their email, never the
 * email. A name applies when the user is created. Pruning disables a user.
 */
import { roles } from '@quanthea/shared';
import { z } from 'zod';
import { defaultAdminLogin } from '../auth/default-admin.ts';
import { hashPassword, passwordProblem } from '../auth/passwords.ts';
import { changeUser, type UserAdminDependencies } from '../auth/user-admin.ts';
import { normalizeEmail, type Users } from '../auth/users.ts';
import type { ConfigFile } from '../config/config-file.ts';
import type { UserRepository } from '../db/user-repository.ts';
import { AppError } from '../lib/errors.ts';
import type { KeyedHash } from '../secrets/keyed-hash.ts';
import type { Peppers } from '../secrets/keys.ts';
import { type Applier, issuesAt, type Planned, provisioningActor } from './reconcile.ts';
import { secretValue } from './secret-references.ts';

/** A user as the file declares it, without the password. */
export const declaredSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    role: z.enum(roles).default('viewer'),
    disabled: z.boolean().default(false),
  })
  .strict();

/** A user ready to apply. */
interface DesiredUser extends Omit<z.output<typeof declaredSchema>, 'name'> {
  /** Their name: as declared, else `Admin` for the admin, else their email's local part. */
  readonly name: string;
  /** Their email as written, or `admin`. */
  readonly email: string;
  /** The password to set while they have none. */
  readonly password?: string;
}

/** What applying users needs. */
export interface UserServices {
  /** The users. */
  readonly users: Users;
  /** Users as stored. */
  readonly userRows: UserRepository;
  /** What changing a user needs. */
  readonly userAdmin: UserAdminDependencies;
}

/**
 * The name the record of what the file manages gives a user: the keyed hash of their email.
 *
 * @param lookupIndex - The email index.
 * @param email - The email.
 * @returns The hash, in hex.
 */
export async function userRecordName(lookupIndex: KeyedHash, email: string): Promise<string> {
  return Buffer.from(await lookupIndex.hash(normalizeEmail(email))).toString('hex');
}

/**
 * What is wrong with a user's key: not an email, or the admin without a password or the role.
 *
 * @param key - The key: an email, or `admin`.
 * @param declared - The user as declared.
 * @param password - Their password, if the file gives one.
 * @returns One sentence per issue.
 */
function keyIssues(key: string, declared: Record<string, unknown>, password?: string): string[] {
  const where = `users.${key}`;
  if (key !== defaultAdminLogin)
    return z.email().safeParse(key.trim()).success ? [] : [`${where}: not an email.`];
  const role = declared.role ?? 'admin';
  return [
    ...(password === undefined
      ? [`${where} needs a password: it has no email to sign in with.`]
      : []),
    ...(role === 'admin' ? [] : [`${where} is an admin; its role cannot change.`]),
  ];
}

/**
 * A user's first password, when the file gives one.
 *
 * @param written - The user as written.
 * @param declared - The user, interpolated.
 * @param where - Where the user is set.
 * @param issues - Collects what is wrong.
 * @returns The password, or `undefined`.
 */
function passwordOf(
  written: Record<string, unknown>,
  declared: Record<string, unknown>,
  where: string,
  issues: string[],
): string | undefined {
  if (written.password === undefined) return undefined;
  return secretValue(written.password, declared.password, `${where}.password`, issues);
}

/**
 * A user's name: as declared, else `Admin` for the admin, else their email's local part.
 *
 * @param key - The user's email, or `admin`.
 * @param declared - The declared name, if any.
 * @returns The name.
 */
function nameOf(key: string, declared: string | undefined): string {
  if (declared) return declared;
  return key === defaultAdminLogin ? 'Admin' : (key.split('@')[0] ?? key);
}

/**
 * One user as declared, checked.
 *
 * @param file - The configuration file.
 * @param key - The user's email, or `admin`.
 * @param issues - Collects what is wrong.
 * @returns The user without its record name, or `undefined` when it is invalid.
 */
function checkOne(file: ConfigFile, key: string, issues: string[]): DesiredUser | undefined {
  const where = `users.${key}`;
  const { password: _secret, ...declared } = (file.sections.users?.[key] ?? {}) as Record<
    string,
    unknown
  >;
  const written = (file.raw.users?.[key] ?? {}) as Record<string, unknown>;
  const password = passwordOf(written, { password: _secret }, where, issues);
  const role = key === defaultAdminLogin ? { role: 'admin' } : {};
  const parsed = declaredSchema.safeParse({ ...role, ...declared });
  issues.push(...keyIssues(key, declared, password));
  if (!parsed.success) issues.push(...issuesAt(where, parsed.error));
  if (!parsed.success) return undefined;
  const name = nameOf(key, parsed.data.name);
  return {
    ...parsed.data,
    name,
    email: key.trim(),
    ...(password === undefined ? {} : { password }),
  };
}

/**
 * The users the file declares, checked, each named by the keyed hash of their email.
 *
 * @param file - The configuration file.
 * @param lookupIndex - The email index.
 * @param issues - Collects what is wrong.
 * @returns The users.
 */
export async function planUsers(
  file: ConfigFile,
  lookupIndex: KeyedHash,
  issues: string[],
): Promise<Planned<DesiredUser>[]> {
  const planned: Planned<DesiredUser>[] = [];
  for (const email of Object.keys(file.sections.users ?? {})) {
    const desired = checkOne(file, email, issues);
    if (!desired) continue;
    const name = await userRecordName(lookupIndex, email);
    planned.push({ name, path: file.origins[`users.${email}`] ?? '', desired, editable: [] });
  }
  return planned;
}

/**
 * Sets a user's password when they have none.
 *
 * @param services - The users.
 * @param peppers - The peppers.
 * @param id - The user.
 * @param desired - The user as declared.
 * @returns Once it is set.
 * @throws {AppError} `bad_request` when the password is refused, without quoting it.
 */
async function setFirstPassword(
  services: UserServices,
  peppers: Peppers,
  id: string,
  desired: DesiredUser,
): Promise<void> {
  if (desired.password === undefined || services.userRows.get(id)?.passwordHash != null) return;
  const problem = passwordProblem(desired.password, desired);
  if (problem) throw new AppError('bad_request', `Its password is refused: ${problem}`);
  const stored = await hashPassword(peppers, desired.password);
  const at = Date.now();
  services.userRows.update(id, {
    passwordHash: stored.hash,
    pepperId: stored.pepperId,
    updatedAt: at,
  });
  services.userAdmin.audit.append({
    actor: provisioningActor,
    action: 'user.password-set',
    target: id,
  });
}

/**
 * Creates or updates one user.
 *
 * @param services - The users.
 * @param desired - The user as declared.
 * @returns The user's id.
 */
async function applyUser(services: UserServices, desired: DesiredUser): Promise<string> {
  const { email, name, role, disabled } = desired;
  const row = await services.users.findByEmail(email);
  const id = row?.id ?? (await services.users.create({ email, name, role }, provisioningActor)).id;
  changeUser(services.userAdmin, id, { role, disabled }, provisioningActor);
  return id;
}

/**
 * How users are applied.
 *
 * @param services - The users.
 * @param peppers - The peppers, for a first password.
 * @returns The applier.
 */
export function userApplier(services: UserServices, peppers: Peppers): Applier<DesiredUser> {
  const rowOf = (name: string) => services.userRows.findByEmailIndex(Buffer.from(name, 'hex'));
  return {
    kind: 'user',
    exists: (name) => rowOf(name) !== undefined,
    apply: async (item) => {
      const id = await applyUser(services, item.desired);
      await setFirstPassword(services, peppers, id, item.desired);
      return 'applied';
    },
    remove: async (name) => {
      const row = rowOf(name);
      if (row) changeUser(services.userAdmin, row.id, { disabled: true }, provisioningActor);
    },
  };
}
