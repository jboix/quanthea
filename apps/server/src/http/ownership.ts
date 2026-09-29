/**
 * Who may do what with a thread and its dashboard. A thread belongs to whoever started it: they
 * read and write it. An admin reads any thread and may delete it, but never writes in it. Anyone
 * else gets "not found", so a thread's existence is not given away. A dashboard's drafts follow
 * its thread; its pinned versions are for everyone.
 */
import type { Principal, Role } from '@querent/shared';
import type { Users } from '../auth/users.ts';
import { AppError } from '../lib/errors.ts';
import type { Threads } from '../threads/threads.ts';

/** The owner of threads started while everyone was an anonymous admin. */
export const anonymousOwner = 'anonymous';

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

/**
 * The role a dashboard's versions are read with: one's own role for a dashboard whose thread one
 * may read, or that has no thread; a viewer's otherwise, so only pinned versions show.
 *
 * @param principal - Who asks.
 * @param owner - The dashboard's thread owner, or `null` without a thread.
 * @returns The role.
 */
export function roleForDashboard(
  principal: Principal,
  owner: { readonly ownerId: string | null } | null,
): Role {
  return owner === null || canRead(principal, owner.ownerId) ? principal.role : 'viewer';
}

/**
 * Whether someone may pin, unpin or edit a dashboard: its thread's owner or an admin, or any
 * editor when it has no thread.
 *
 * @param principal - Who asks.
 * @param owner - The dashboard's thread owner, or `null` without a thread.
 * @returns Whether they may.
 */
export function canChangeDashboard(
  principal: Principal,
  owner: { readonly ownerId: string | null } | null,
): boolean {
  return owner === null || principal.role === 'admin' || principal.id === owner.ownerId;
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
      ownerId === anonymousOwner || ownerId === null
        ? Promise.resolve('Anonymous')
        : users.nameOf(ownerId).then((found) => found ?? 'A removed user');
    cache.set(key, name);
    return name;
  };
}
