/**
 * The bin of threads. Deleting a thread moves it here, unless its dashboard is pinned or its alert
 * or report is active; restoring brings it back. Purging deletes the thread and its dashboard with
 * every version, which frees the space; the usage ledger has no link to either, so usage is kept.
 * Purging skips a thread whose alert or report is active.
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
   * @throws {AppError} `not_found`; `bad_request` when its dashboard is pinned or its alert or
   *   report is active.
   */
  bin(id: string, actor: string): void;
  /**
   * Moves every draft of an owner to the bin at once: their threads whose dashboard is not pinned
   * and whose alert or report is not active. Others' threads are never touched.
   *
   * @param ownerId - Whose drafts.
   * @param actor - Who deletes them.
   * @returns How many went to the bin.
   */
  binDrafts(ownerId: string, actor: string): number;
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
   * @throws {AppError} `not_found` when it is not in the bin; `bad_request` when its alert or
   *   report is active.
   */
  purge(id: string, actor: string): void;
  /**
   * Deletes the threads binned before a time, or every binned thread, but those whose alert or
   * report is active.
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
  /**
   * A thread's owner, in the bin or not: whose alert or report drafts the thread made.
   *
   * @param threadId - The thread.
   * @returns The thread and whether it is binned, or `null`.
   */
  threadOwner(threadId: string): ThreadOwner | null;
}

/**
 * Refuses a thread whose alert or report is active.
 *
 * @param outcome - What the repository did.
 * @throws {AppError} `bad_request` for `alert_active` or `report_active`.
 */
function checkNothingActive(outcome: string): void {
  if (outcome === 'alert_active')
    throw new AppError('bad_request', 'Its alert is active. Deactivate it before deleting.');
  if (outcome === 'report_active')
    throw new AppError('bad_request', 'Its report is active. Deactivate it before deleting.');
}

/**
 * Moves one thread to the bin, or says why it can't go.
 *
 * @param dependencies - The repository, the audit log and the clock.
 * @returns The method.
 */
function threadBinner(dependencies: ThreadBinDependencies): ThreadBin['bin'] {
  const { repository, audit } = dependencies;
  const now = dependencies.now ?? Date.now;
  return (id, actor) => {
    const outcome = repository.bin(id, now(), actor);
    if (outcome === 'missing') throw new AppError('not_found', `No thread ${id}.`);
    if (outcome === 'pinned')
      throw new AppError('bad_request', 'Its dashboard is pinned. Unpin it before deleting.');
    checkNothingActive(outcome);
    audit.append({ actor, action: 'thread.bin', target: id });
  };
}

/**
 * Moves an owner's drafts to the bin, and records it once with the threads' ids.
 *
 * @param dependencies - The repository, the audit log and the clock.
 * @returns The method.
 */
function draftBinner(dependencies: ThreadBinDependencies): ThreadBin['binDrafts'] {
  const { repository, audit } = dependencies;
  const now = dependencies.now ?? Date.now;
  return (ownerId, actor) => {
    const ids = repository.binDrafts(ownerId, now(), actor);
    if (ids.length > 0)
      audit.append({ actor, action: 'thread.bin_drafts', detail: { threadIds: ids } });
    return ids.length;
  };
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
    const outcome = repository.purge(id);
    if (outcome === 'missing') throw new AppError('not_found', `No thread ${id} in the bin.`);
    checkNothingActive(outcome);
    audit.append({ actor, action: 'thread.purge', target: id });
  };
  return {
    bin: threadBinner(dependencies),
    binDrafts: draftBinner(dependencies),
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
    threadOwner: (threadId) => repository.threadOwner(threadId) ?? null,
  };
}
