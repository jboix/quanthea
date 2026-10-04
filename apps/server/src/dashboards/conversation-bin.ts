/**
 * The bin of conversations about dashboards. Whoever started a conversation moves it to the bin,
 * and admins move any; analysts and above only, the roles that ask. A binned conversation leaves
 * History, the search, "already answered" and the Ask tab, and can't be continued. Its starter,
 * whoever binned it, and admins restore it; admins delete it for good, with its questions. The
 * usage ledger has no link to questions, so usage is kept.
 */
import { hasRole, type Role } from '@quanthea/shared';
import type { BinnedConversationRow, ConversationBinRepository } from '../db/conversation-bin.ts';
import type { QuestionRepository } from '../db/question-repository.ts';
import { AppError } from '../lib/errors.ts';
import { type DashboardsDependencies, get, type ServiceContext } from './context.ts';

/** Who acts on the bin. */
export interface BinActor {
  /** Their user id. */
  readonly id: string;
  /** Their role. */
  readonly role: Role;
}

/** What the bin of conversations needs besides the dashboards' context. */
export interface ConversationBinDependencies {
  /** Stores the bin. */
  readonly binnedConversations: ConversationBinRepository;
  /** Stores questions, for a conversation's starter. */
  readonly questions: QuestionRepository;
}

/** The bin of conversations. */
export interface ConversationBin {
  /**
   * Moves a conversation to the bin.
   *
   * @param target - The dashboard and the conversation.
   * @param actor - Who bins it.
   * @param role - The role the dashboard is read with.
   * @throws {AppError} `not_found` for a dashboard the role may not see or a conversation not on
   *   it, `forbidden` when the actor neither started it nor is an admin.
   */
  bin(
    target: { readonly dashboardId: string; readonly conversationId: string },
    actor: BinActor,
    role: Role,
  ): void;
  /**
   * Takes a conversation out of the bin.
   *
   * @param conversationId - The conversation.
   * @param actor - Who restores it.
   * @throws {AppError} `not_found` when it is not in the bin, or not the actor's to restore.
   */
  restore(conversationId: string, actor: BinActor): void;
  /**
   * Lists the binned conversations someone may restore, the most recently binned first.
   *
   * @param actor - Who asks.
   * @returns The conversations.
   */
  list(actor: BinActor): BinnedConversationRow[];
  /**
   * Deletes a binned conversation for good, with its questions.
   *
   * @param conversationId - The conversation.
   * @param actor - Who deletes it.
   * @throws {AppError} `not_found` when it is not in the bin.
   */
  purge(conversationId: string, actor: string): void;
  /**
   * Deletes the conversations binned before a time, or every binned conversation.
   *
   * @param actor - Who deletes them: a person, or the retention job.
   * @param before - Only those binned before this time; all of them without it.
   * @returns How many were deleted.
   */
  purgeAll(actor: string, before?: number): number;
}

/**
 * Whether someone may move a conversation to the bin: analysts and above who started it, and
 * admins.
 *
 * @param actor - Who asks.
 * @param starterId - Who started the conversation.
 * @returns Whether they may.
 */
export function mayBin(actor: BinActor, starterId: string): boolean {
  if (!hasRole(actor.role, 'analyst')) return false;
  return actor.role === 'admin' || actor.id === starterId;
}

/**
 * Whether someone may restore a binned conversation: its starter, whoever binned it, and admins.
 *
 * @param actor - Who asks.
 * @param binned - The binned conversation.
 * @returns Whether they may.
 */
function mayRestore(actor: BinActor, binned: BinnedConversationRow): boolean {
  if (!hasRole(actor.role, 'analyst')) return false;
  return actor.role === 'admin' || actor.id === binned.startedBy || actor.id === binned.binnedBy;
}

/** The service's context. */
type BinContext = ServiceContext & ConversationBinDependencies;

/**
 * Moves a conversation to the bin, after checking the actor may.
 *
 * @param context - The service context.
 * @param target - The dashboard and the conversation.
 * @param actor - Who bins it.
 * @param role - The role the dashboard is read with.
 */
function binOne(
  context: BinContext,
  target: { readonly dashboardId: string; readonly conversationId: string },
  actor: BinActor,
  role: Role,
): void {
  const { dashboardId, conversationId } = target;
  get(context, dashboardId, role);
  const conversation = context.questions.conversation(dashboardId, conversationId);
  if (!conversation)
    throw new AppError('not_found', `No conversation ${conversationId} on this dashboard.`);
  if (!mayBin(actor, conversation.startedBy))
    throw new AppError(
      'forbidden',
      'Only whoever started this conversation, or an admin, can move it to the bin.',
    );
  context.binnedConversations.bin(conversationId, context.now(), actor.id);
  context.audit.append({ actor: actor.id, action: 'conversation.bin', target: conversationId });
}

/**
 * Takes a conversation out of the bin, after checking the actor may.
 *
 * @param context - The service context.
 * @param conversationId - The conversation.
 * @param actor - Who restores it.
 */
function restoreOne(context: BinContext, conversationId: string, actor: BinActor): void {
  const binned = context.binnedConversations.get(conversationId);
  // Someone else's binned conversation is not given away.
  if (!binned || !mayRestore(actor, binned))
    throw new AppError('not_found', `No conversation ${conversationId} in the bin.`);
  context.binnedConversations.restore(conversationId);
  context.audit.append({ actor: actor.id, action: 'conversation.restore', target: conversationId });
}

/**
 * Creates the bin of conversations.
 *
 * @param dependencies - The dashboards' context, the bin's store and the questions' store.
 * @returns The bin.
 */
export function createConversationBin(
  dependencies: DashboardsDependencies & ConversationBinDependencies,
): ConversationBin {
  const context: BinContext = { ...dependencies, now: dependencies.now ?? Date.now };
  const { binnedConversations, audit } = context;
  const purge = (conversationId: string, actor: string) => {
    if (!binnedConversations.purge(conversationId))
      throw new AppError('not_found', `No conversation ${conversationId} in the bin.`);
    audit.append({ actor, action: 'conversation.purge', target: conversationId });
  };
  return {
    bin: (target, actor, role) => binOne(context, target, actor, role),
    restore: (conversationId, actor) => restoreOne(context, conversationId, actor),
    list: (actor) => binnedConversations.list().filter((binned) => mayRestore(actor, binned)),
    purge,
    purgeAll: (actor, before) => {
      const ids = binnedConversations.binnedBefore(before ?? Number.POSITIVE_INFINITY);
      for (const id of ids) purge(id, actor);
      return ids.length;
    },
  };
}
