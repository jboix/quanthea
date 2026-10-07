/**
 * What admins change about a user: the role, and whether they may sign in. quanthea always keeps
 * at least one admin who can sign in, and a disabled user's sessions end at once.
 */
import type { Role } from '@quanthea/shared';
import type { AuditRepository } from '../db/audit-repository.ts';
import type { UserChange, UserRepository, UserRow } from '../db/user-repository.ts';
import { AppError } from '../lib/errors.ts';
import type { Sessions } from './sessions.ts';

/** What changing a user needs. */
export interface UserAdminDependencies {
  /** Stores users. */
  readonly repository: UserRepository;
  /** Ends a disabled user's sessions, when there are sessions. */
  readonly sessions: Pick<Sessions, 'endAllOf'> | undefined;
  /** Records who did what. */
  readonly audit: AuditRepository;
  /** The clock; `Date.now` by default. */
  readonly now?: () => number;
}

/** What an admin may change about a user. */
export interface UserChangeInput {
  /** The new role. */
  readonly role?: Role | undefined;
  /** Whether the user may no longer sign in. */
  readonly disabled?: boolean | undefined;
}

/**
 * Whether a change would leave no admin who can sign in.
 *
 * @param repository - The users.
 * @param row - The user before the change.
 * @param change - The change.
 * @returns Whether it would.
 */
function leavesNoAdmin(repository: UserRepository, row: UserRow, change: UserChangeInput): boolean {
  if (row.role !== 'admin' || row.disabledAt !== null) return false;
  const losesAdmin =
    (change.role !== undefined && change.role !== 'admin') || change.disabled === true;
  return losesAdmin && repository.countAdmins() <= 1;
}

/**
 * The stored form of a change.
 *
 * @param change - The change.
 * @param at - When.
 * @returns The fields to write.
 */
function storedChange(change: UserChangeInput, at: number): UserChange {
  const disabledAt = change.disabled ? at : null;
  const disabled = change.disabled === undefined ? {} : { disabledAt };
  return { ...(change.role ? { role: change.role } : {}), ...disabled, updatedAt: at };
}

/**
 * Changes a user's role or whether they may sign in.
 *
 * @param dependencies - The repository, the sessions, the audit log and the clock.
 * @param id - The user.
 * @param change - The new role, or whether they are disabled.
 * @param actor - Who changes it.
 * @throws {AppError} `not_found`; `bad_request` when it would leave no admin who can sign in.
 */
export function changeUser(
  dependencies: UserAdminDependencies,
  id: string,
  change: UserChangeInput,
  actor: string,
): void {
  const { repository, audit } = dependencies;
  const row = repository.get(id);
  if (!row) throw new AppError('not_found', `No user ${id}.`);
  if (leavesNoAdmin(repository, row, change))
    throw new AppError('bad_request', 'quanthea needs at least one admin who can sign in.');
  repository.update(id, storedChange(change, (dependencies.now ?? Date.now)()));
  if (change.disabled) dependencies.sessions?.endAllOf(id);
  audit.append({ actor, action: 'user.change', target: id, detail: change });
}
