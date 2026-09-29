/** Who owns threads: counting and handing over the threads of one owner. */
import type { Database } from 'bun:sqlite';

/** Counts and hands over threads by owner. */
export interface ThreadOwnershipRepository {
  /**
   * How many threads an owner has, in the bin or not.
   *
   * @param ownerId - The owner.
   * @returns The count.
   */
  count(ownerId: string): number;
  /**
   * Gives every thread of one owner to another.
   *
   * @param fromOwnerId - The owner now.
   * @param toOwnerId - The new owner.
   * @returns How many threads changed hands.
   */
  handOver(fromOwnerId: string, toOwnerId: string): number;
}

/**
 * Creates the repository over an open database.
 *
 * @param database - A database the migrations have run on.
 * @returns The repository.
 */
export function createThreadOwnershipRepository(database: Database): ThreadOwnershipRepository {
  const count = database.query<{ count: number }, [string]>(
    'SELECT count(*) AS count FROM threads WHERE created_by = ?',
  );
  return {
    count: (ownerId) => count.get(ownerId)?.count ?? 0,
    handOver: (fromOwnerId, toOwnerId) =>
      database.run('UPDATE threads SET created_by = ? WHERE created_by = ?', [
        toOwnerId,
        fromOwnerId,
      ]).changes,
  };
}
