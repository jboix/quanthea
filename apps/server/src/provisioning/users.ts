/**
 * Users in the configuration file, keyed by email: their name, role, and whether they are
 * disabled. A user the file declares starts invited; they sign in through a provider with that
 * verified email, or with a password the file gives while they have none:
 *
 * ```yaml
 * users:
 *   ada@example.com: { name: Ada Lovelace, role: admin, password: "${ADMIN_PASSWORD}" }
 * ```
 *
 * The record of what the file manages names a user by the keyed hash of their email, never the
 * email. A name applies when the user is created. Pruning disables a user.
 */
import { roles } from '@querent/shared';
import { z } from 'zod';
import { hashPassword, passwordProblem } from '../auth/passwords.ts';
import { changeUser, type UserAdminDependencies } from '../auth/user-admin.ts';
import { normalizeEmail, type Users } from '../auth/users.ts';
import type { ConfigFile } from '../config/config-file.ts';
import type { UserRepository } from '../db/user-repository.ts';
import { AppError } from '../lib/errors.ts';
import type { KeyedHash } from '../secrets/keyed-hash.ts';
import type { Peppers } from '../secrets/keys.ts';
import { type Applier, type Planned, provisioningActor } from './reconcile.ts';
import { secretValue } from './secret-references.ts';

/** A user as the file declares it, without the password. */
export const declaredSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    role: z.enum(roles).default('viewer'),
    disabled: z.boolean().default(false),
  })
  .strict();

/** A user ready to apply. */
interface DesiredUser extends z.output<typeof declaredSchema> {
  /** Their email, as written. */
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
 * One user as declared, checked.
 *
 * @param file - The configuration file.
 * @param email - The user's email.
 * @param issues - Collects what is wrong.
 * @returns The user without its record name, or `undefined` when it is invalid.
 */
function checkOne(file: ConfigFile, email: string, issues: string[]): DesiredUser | undefined {
  const where = `users.${email}`;
  const declared = { ...(file.sections.users?.[email] as object) } as Record<string, unknown>;
  const written = (file.raw.users?.[email] ?? {}) as Record<string, unknown>;
  const password =
    written.password === undefined
      ? undefined
      : secretValue(written.password, declared.password, `${where}.password`, issues);
  delete declared.password;
  const parsed = declaredSchema.safeParse(declared);
  if (!z.email().safeParse(email.trim()).success) issues.push(`${where}: not an email.`);
  if (!parsed.success)
    issues.push(
      ...parsed.error.issues.map((issue) => `${where}.${issue.path.join('.')}: ${issue.message}`),
    );
  if (!parsed.success) return undefined;
  return { ...parsed.data, email: email.trim(), ...(password === undefined ? {} : { password }) };
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
