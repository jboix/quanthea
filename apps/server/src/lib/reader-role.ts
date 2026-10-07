/**
 * The role an alert or a report is read with. Its drafts follow the thread that made it, so the
 * routes pass a function of that thread; the server's own callers pass a role.
 */
import type { Role } from '@quanthea/shared';

/** A role, or the role for what a given thread made: `null` for no thread. */
export type ReaderRole = Role | ((threadId: string | null) => Role);

/**
 * The role to read something with.
 *
 * @param reader - The role, or how to find it from the thread.
 * @param threadId - The thread that made what is read, or `null`.
 * @returns The role.
 */
export function roleOn(reader: ReaderRole, threadId: string | null): Role {
  return typeof reader === 'function' ? reader(threadId) : reader;
}
