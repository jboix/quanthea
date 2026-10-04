/**
 * The bin of conversations about reports' runs, under the same rules as the bin of conversations
 * about dashboards: whoever started a conversation moves it to the bin, and admins move any;
 * analysts and above only. Its starter, whoever binned it, and admins restore it; admins delete it
 * for good, with its questions. A binned conversation leaves History, the search and "already
 * answered", and can't be continued.
 */
import { hasRole, periodLabel, type Role, reportSpecSchema } from '@quanthea/shared';
import { type BinActor, mayBin } from '../dashboards/conversation-bin.ts';
import type { AuditRepository } from '../db/audit-repository.ts';
import type {
  BinnedRunConversationRow,
  ReportConversationBinRepository,
} from '../db/report-conversation-bin.ts';
import type { ReportQuestionRepository } from '../db/report-question-repository.ts';
import type { ReportRepository } from '../db/report-repository.ts';
import { AppError } from '../lib/errors.ts';
import type { RunTarget } from './questions.ts';
import type { Reports } from './reports.ts';

/** A binned conversation about a run, with its run's period named. */
export type BinnedRunConversation = BinnedRunConversationRow & {
  /** The period, such as `week 40, 29 Sep – 5 Oct`. */
  readonly period: string;
};

/** What the bin of conversations about runs needs. */
export interface RunConversationBinDependencies {
  /** Stores the bin. */
  readonly binned: ReportConversationBinRepository;
  /** Stores the questions, for a conversation's starter. */
  readonly questions: ReportQuestionRepository;
  /** The reports, to read a run as a role reads it. */
  readonly reports: Pick<Reports, 'run'>;
  /** The reports' versions, for the periods' names. */
  readonly repository: Pick<ReportRepository, 'version'>;
  /** Records who did what. */
  readonly audit: AuditRepository;
  /** The clock; `Date.now` by default. */
  readonly now?: () => number;
}

/** The bin of conversations about runs. */
export interface RunConversationBin {
  /**
   * Moves a conversation to the bin.
   *
   * @param target - The run and the conversation.
   * @param actor - Who bins it.
   * @param role - The role the run is read with.
   * @throws {AppError} `not_found` for a run the role may not see or a conversation not on it,
   *   `forbidden` when the actor neither started it nor is an admin.
   */
  bin(target: RunTarget & { readonly conversationId: string }, actor: BinActor, role: Role): void;
  /**
   * Takes a conversation out of the bin.
   *
   * @param conversationId - The conversation.
   * @param actor - Who restores it.
   * @returns `false` when it is not in the bin, or not the actor's to restore.
   */
  restore(conversationId: string, actor: BinActor): boolean;
  /**
   * Lists the binned conversations someone may restore, the most recently binned first.
   *
   * @param actor - Who asks.
   * @returns The conversations.
   */
  list(actor: BinActor): BinnedRunConversation[];
  /**
   * Deletes a binned conversation for good, with its questions.
   *
   * @param conversationId - The conversation.
   * @param actor - Who deletes it.
   * @returns `false` when it is not in the bin.
   */
  purge(conversationId: string, actor: string): boolean;
  /**
   * Deletes the conversations binned before a time, or every binned one.
   *
   * @param actor - Who deletes them: a person, or the retention job.
   * @param before - Only those binned before this time; all of them without it.
   * @returns How many were deleted.
   */
  purgeAll(actor: string, before?: number): number;
}

/**
 * Whether someone may restore a binned conversation: its starter, whoever binned it, and admins.
 *
 * @param actor - Who asks.
 * @param binned - The binned conversation.
 * @returns Whether they may.
 */
function mayRestore(actor: BinActor, binned: BinnedRunConversationRow): boolean {
  if (!hasRole(actor.role, 'analyst')) return false;
  return actor.role === 'admin' || actor.id === binned.startedBy || actor.id === binned.binnedBy;
}

/**
 * Names a binned conversation's period, from the spec of the version its run ran.
 *
 * @param repository - The reports' versions.
 * @param row - The binned conversation.
 * @returns The conversation with its period.
 */
function withPeriod(
  repository: Pick<ReportRepository, 'version'>,
  row: BinnedRunConversationRow,
): BinnedRunConversation {
  const spec = reportSpecSchema.safeParse(repository.version(row.reportId, row.version)?.spec);
  const range = { from: row.periodFrom, to: row.periodTo };
  const period = spec.success
    ? periodLabel(spec.data.period, range, spec.data.schedule.timezone)
    : new Date(row.periodFrom).toISOString().slice(0, 10);
  return { ...row, period };
}

/**
 * Moves a conversation about a run to the bin, after checking the actor may.
 *
 * @param dependencies - The bin's dependencies.
 * @param target - The run and the conversation.
 * @param actor - Who bins it.
 * @param role - The role the run is read with.
 */
function binOne(
  dependencies: RunConversationBinDependencies,
  target: RunTarget & { readonly conversationId: string },
  actor: BinActor,
  role: Role,
): void {
  const { runId, conversationId } = target;
  dependencies.reports.run(target.reportId, runId, role);
  const conversation = dependencies.questions.conversation(runId, conversationId);
  if (!conversation)
    throw new AppError('not_found', `No conversation ${conversationId} on this run.`);
  if (!mayBin(actor, conversation.startedBy))
    throw new AppError(
      'forbidden',
      'Only whoever started this conversation, or an admin, can move it to the bin.',
    );
  dependencies.binned.bin(conversationId, (dependencies.now ?? Date.now)(), actor.id);
  dependencies.audit.append({
    actor: actor.id,
    action: 'conversation.bin',
    target: conversationId,
  });
}

/**
 * Creates the bin of conversations about runs.
 *
 * @param dependencies - The bin's store, the questions, the reports and the audit log.
 * @returns The bin.
 */
export function createRunConversationBin(
  dependencies: RunConversationBinDependencies,
): RunConversationBin {
  const { binned, audit } = dependencies;
  const purge = (conversationId: string, actor: string) => {
    if (!binned.purge(conversationId)) return false;
    audit.append({ actor, action: 'conversation.purge', target: conversationId });
    return true;
  };
  return {
    bin: (target, actor, role) => binOne(dependencies, target, actor, role),
    restore: (conversationId, actor) => {
      const row = binned.get(conversationId);
      if (!row || !mayRestore(actor, row)) return false;
      binned.restore(conversationId);
      audit.append({ actor: actor.id, action: 'conversation.restore', target: conversationId });
      return true;
    },
    list: (actor) =>
      binned
        .list()
        .filter((row) => mayRestore(actor, row))
        .map((row) => withPeriod(dependencies.repository, row)),
    purge,
    purgeAll: (actor, before) => {
      const ids = binned.binnedBefore(before ?? Number.POSITIVE_INFINITY);
      return ids.filter((id) => purge(id, actor)).length;
    },
  };
}
