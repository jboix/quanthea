/**
 * The bin of threads. Deleting a thread moves it here, unless its dashboard is pinned; restoring
 * brings it back. Purging deletes the thread and its dashboard with every version, which frees the
 * space; the usage ledger has no link to either, so usage is kept.
 */
import type { AuditRepository } from '../db/audit-repository.ts';
import type { BinnedRow, ThreadBinRepository, ThreadOwner } from '../db/thread-bin.ts';

export type { ThreadOwner } from '../db/thread-bin.ts';

import { AppError } from '../lib/errors.ts';

/** What the bin needs. */
export interface ThreadBinDependencies {
  /** Stores the bin. */
  readonly repository: ThreadBinRepository;
  /** Records who did what. */
  readonly audit: AuditRepository;
  /** The clock; `Date.now` by default. */
  readonly now?: () => number;
}

/** The bin of threads. */
export interface ThreadBin {
  /**
   * Moves a thread to the bin.
   *
   * @param id - The thread.
   * @param actor - Who deletes it.
   * @throws {AppError} `not_found`; `bad_request` when its dashboard is pinned.
   */
  bin(id: string, actor: string): void;
  /**
   * Takes a thread out of the bin.
   *
   * @param id - The thread.
   * @param actor - Who restores it.
   * @throws {AppError} `not_found` when it is not in the bin.
   */
  restore(id: string, actor: string): void;
  /**
   * Lists the threads in the bin.
   *
   * @returns The threads, the most recently binned first.
   */
  list(): BinnedRow[];
  /**
   * Deletes a binned thread for good, with its dashboard.
   *
   * @param id - The thread.
   * @param actor - Who deletes it.
   * @throws {AppError} `not_found` when it is not in the bin.
   */
  purge(id: string, actor: string): void;
  /**
   * Deletes the threads binned before a time, or every binned thread.
   *
   * @param actor - Who deletes them: a person, or the retention job.
   * @param before - Only those binned before this time; all of them without it.
   * @returns How many were deleted.
   */
  purgeAll(actor: string, before?: number): number;
  /**
   * The thread a dashboard belongs to, in the bin or not.
   *
   * @param dashboardId - The dashboard.
   * @returns The thread and whether it is binned, or `null`.
   */
  ownerOf(dashboardId: string): ThreadOwner | null;
}

/**
 * Creates the bin.
 *
 * @param dependencies - The repository, the audit log and the clock.
 * @returns The bin.
 */
export function createThreadBin(dependencies: ThreadBinDependencies): ThreadBin {
  const { repository, audit } = dependencies;
  const now = dependencies.now ?? Date.now;
  const purge = (id: string, actor: string) => {
    if (!repository.purge(id)) throw new AppError('not_found', `No thread ${id} in the bin.`);
    audit.append({ actor, action: 'thread.purge', target: id });
  };
  return {
    bin: (id, actor) => {
      const outcome = repository.bin(id, now(), actor);
      if (outcome === 'missing') throw new AppError('not_found', `No thread ${id}.`);
      if (outcome === 'pinned')
        throw new AppError('bad_request', 'Its dashboard is pinned. Unpin it before deleting.');
      audit.append({ actor, action: 'thread.bin', target: id });
    },
    restore: (id, actor) => {
      if (!repository.restore(id, now()))
        throw new AppError('not_found', `No thread ${id} in the bin.`);
      audit.append({ actor, action: 'thread.restore', target: id });
    },
    list: () => repository.list(),
    purge,
    purgeAll: (actor, before) => {
      const ids = repository.binnedBefore(before ?? Number.POSITIVE_INFINITY);
      for (const id of ids) purge(id, actor);
      return ids.length;
    },
    ownerOf: (dashboardId) => repository.ownerOf(dashboardId) ?? null,
  };
}
