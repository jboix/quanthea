/**
 * Who may do what with a thread and what it made. A thread belongs to whoever started it: they
 * read and write it. An admin reads any thread and may delete it, but never writes in it. Anyone
 * else gets "not found", so a thread's existence is not given away. The drafts of a dashboard, an
 * alert or a report follow its thread; its pinned or active versions are for everyone.
 */
import { hasRole, type Principal, type Role } from '@quanthea/shared';
import type { Users } from '../auth/users.ts';
import { AppError } from '../lib/errors.ts';
import type { Threads } from '../threads/threads.ts';

/**
 * Whether someone may read a thread.
 *
 * @param principal - Who asks.
 * @param ownerId - The thread's owner.
 * @returns Whether they own it or are an admin.
 */
export function canRead(principal: Principal, ownerId: string | null): boolean {
  return principal.role === 'admin' || principal.id === ownerId;
}

/**
 * Whether someone may write in a thread: only its owner.
 *
 * @param principal - Who asks.
 * @param ownerId - The thread's owner.
 * @returns Whether they own it.
 */
export function canWrite(principal: Principal, ownerId: string | null): boolean {
  return principal.id === ownerId;
}

/**
 * Checks someone may read, or write in, a thread.
 *
 * @param threads - The threads.
 * @param principal - Who asks.
 * @param threadId - The thread.
 * @param need - Reading, or writing.
 * @throws {AppError} `not_found` when they may not read it; `forbidden` when they may read it but
 *   not write in it.
 */
export function checkThread(
  threads: Pick<Threads, 'row'>,
  principal: Principal,
  threadId: string,
  need: 'read' | 'write',
): void {
  const ownerId = threads.row(threadId).createdBy;
  if (!canRead(principal, ownerId)) throw new AppError('not_found', `No thread ${threadId}.`);
  if (need === 'write' && !canWrite(principal, ownerId))
    throw new AppError('forbidden', 'Only its owner can write in this thread; admins may read it.');
}

/** The owner of the thread something belongs to, or `null` when it has no thread. */
type Owner = { readonly ownerId: string | null } | null;

/**
 * The role a dashboard's, an alert's or a report's versions are read with: one's own role for one
 * whose thread one may read, or that has no thread; a viewer's otherwise, so only pinned or active
 * versions show.
 *
 * @param principal - Who asks.
 * @param owner - The thread's owner, or `null` without a thread.
 * @returns The role.
 */
export function roleForDashboard(principal: Principal, owner: Owner): Role {
  return owner === null || canRead(principal, owner.ownerId) ? principal.role : 'viewer';
}

/**
 * Whether someone may pin, unpin or edit a dashboard, or activate, deactivate, change, run or test
 * an alert or a report: its thread's owner or an admin, or any editor when it has no thread.
 *
 * @param principal - Who asks.
 * @param owner - The thread's owner, or `null` without a thread.
 * @returns Whether they may.
 */
export function canChangeDashboard(principal: Principal, owner: Owner): boolean {
  return owner === null || principal.role === 'admin' || principal.id === owner.ownerId;
}

/**
 * Refuses a change unless the person may make it (`canChangeDashboard`).
 *
 * @param principal - Who asks.
 * @param owner - The thread's owner, or `null` without a thread.
 * @throws {AppError} `forbidden`.
 */
export function checkOwnerChange(principal: Principal, owner: Owner): void {
  if (!canChangeDashboard(principal, owner))
    throw new AppError('forbidden', 'Only the owner of its thread, or an admin, can change this.');
}

/**
 * The owner of the thread that made an alert or a report.
 *
 * @param threadOwner - Finds a thread's owner.
 * @param threadId - The thread, or `null` when there is none.
 * @returns The owner, or `null` without a thread.
 */
export function madeBy(threadOwner: (threadId: string) => Owner, threadId: string | null): Owner {
  return threadId ? threadOwner(threadId) : null;
}

/**
 * Whether someone may change an alert or a report: an editor who may change what its thread made.
 *
 * @param principal - Who asks.
 * @param owner - The thread's owner, or `null` without a thread.
 * @returns Whether they may.
 */
export function canChangeAs(principal: Principal, owner: Owner): boolean {
  return hasRole(principal.role, 'editor') && canChangeDashboard(principal, owner);
}

/**
 * The role someone reads what each thread made with, for the alerts and reports services.
 *
 * @param principal - Who reads.
 * @param threadOwner - Finds a thread's owner.
 * @returns The role for what a thread made, or for what has no thread.
 */
export function readerRole(
  principal: Principal,
  threadOwner: (threadId: string) => Owner,
): (threadId: string | null) => Role {
  return (threadId) => roleForDashboard(principal, madeBy(threadOwner, threadId));
}

/**
 * Names owners for lists, looking each up once.
 *
 * @param users - The users.
 * @returns The name of an owner.
 */
export function ownerNames(users: Pick<Users, 'nameOf'>) {
  const cache = new Map<string, Promise<string>>();
  return (ownerId: string | null): Promise<string> => {
    const key = ownerId ?? '';
    const known = cache.get(key);
    if (known) return known;
    const name =
      ownerId === null
        ? Promise.resolve('No one')
        : users.nameOf(ownerId).then((found) => found ?? 'A removed user');
    cache.set(key, name);
    return name;
  };
}
