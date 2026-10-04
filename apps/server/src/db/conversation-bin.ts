/**
 * The bin of conversations about dashboards: moving a conversation in and out, listing it, and
 * purging it with its questions. A binned conversation keeps its questions as they were stored and
 * gains a row in `conversation_bin`; the question reads (`question-repository.ts`,
 * `conversation-queries.ts`) skip it through {@link outsideBin}.
 */
import type { Database } from 'bun:sqlite';

/**
 * The SQL condition that keeps a question only while its conversation is outside the bin.
 *
 * @param alias - The alias of `dashboard_questions` in the query.
 * @returns The condition.
 */
export function outsideBin(alias: string): string {
  return `NOT EXISTS (SELECT 1 FROM conversation_bin WHERE conversation_id = ${alias}.root_id)`;
}

/** A conversation in the bin. */
export interface BinnedConversationRow {
  /** The conversation: its first question's id. */
  readonly id: string;
  /** Its dashboard. */
  readonly dashboardId: string;
  /** The dashboard's title. */
  readonly dashboardTitle: string;
  /** Its first question. */
  readonly question: string;
  /** Who asked the first question, by user id. */
  readonly startedBy: string;
  /** When, in epoch milliseconds. */
  readonly startedAt: number;
  /** How many questions it holds. */
  readonly count: number;
  /** When it went to the bin, in epoch milliseconds. */
  readonly binnedAt: number;
  /** Who moved it there, by user id. */
  readonly binnedBy: string;
}

/** Stores the bin of conversations. */
export interface ConversationBinRepository {
  /**
   * Moves a conversation to the bin.
   *
   * @param conversationId - The conversation's first question.
   * @param at - When.
   * @param actor - Who.
   * @returns `false` when there is no such conversation outside the bin.
   */
  bin(conversationId: string, at: number, actor: string): boolean;
  /**
   * Takes a conversation out of the bin.
   *
   * @param conversationId - The conversation.
   * @returns `false` when it is not in the bin.
   */
  restore(conversationId: string): boolean;
  /**
   * Reads a binned conversation.
   *
   * @param conversationId - The conversation.
   * @returns It, or `undefined` when it is not in the bin.
   */
  get(conversationId: string): BinnedConversationRow | undefined;
  /**
   * Lists the conversations in the bin, the most recently binned first.
   *
   * @returns The conversations.
   */
  list(): BinnedConversationRow[];
  /**
   * Lists the conversations binned before a time.
   *
   * @param before - The time.
   * @returns Their ids.
   */
  binnedBefore(before: number): string[];
  /**
   * Deletes a binned conversation with its questions and their index rows, in one transaction.
   *
   * @param conversationId - The conversation.
   * @returns `false` when it is not in the bin.
   */
  purge(conversationId: string): boolean;
}

/** The columns of a binned conversation, named as {@link BinnedConversationRow}. */
const binnedColumns = `SELECT bin.conversation_id AS id, root.dashboard_id AS dashboardId,
    d.title AS dashboardTitle, root.question, root.asked_by AS startedBy,
    root.asked_at AS startedAt,
    (SELECT count(*) FROM dashboard_questions WHERE root_id = root.id) AS count,
    bin.binned_at AS binnedAt, bin.binned_by AS binnedBy
  FROM conversation_bin AS bin
  JOIN dashboard_questions AS root ON root.id = bin.conversation_id
  JOIN dashboards AS d ON d.id = root.dashboard_id`;

/**
 * Prepares the statements of the bin.
 *
 * @param database - A database the migrations have run on.
 * @returns The statements.
 */
function binStatements(database: Database) {
  return {
    bin: database.query<unknown, [string, string, number]>(
      `INSERT OR IGNORE INTO conversation_bin (conversation_id, binned_by, binned_at)
       SELECT id, ?2, ?3 FROM dashboard_questions WHERE id = ?1 AND root_id = id`,
    ),
    restore: database.query('DELETE FROM conversation_bin WHERE conversation_id = ?'),
    get: database.query<BinnedConversationRow, [string]>(
      `${binnedColumns} WHERE bin.conversation_id = ?`,
    ),
    list: database.query<BinnedConversationRow, []>(
      `${binnedColumns} ORDER BY bin.binned_at DESC, bin.conversation_id DESC`,
    ),
    before: database.query<{ id: string }, [number]>(
      'SELECT conversation_id AS id FROM conversation_bin WHERE binned_at < ?',
    ),
    binned: database.query<{ id: string }, [string]>(
      'SELECT conversation_id AS id FROM conversation_bin WHERE conversation_id = ?',
    ),
    // The first question goes last: its bin row goes with it.
    removeFollowUps: database.query(
      'DELETE FROM dashboard_questions WHERE root_id = ?1 AND id <> ?1',
    ),
    removeFirst: database.query('DELETE FROM dashboard_questions WHERE id = ?'),
  };
}

/**
 * Builds the transaction that purges a binned conversation.
 *
 * @param database - A database the migrations have run on.
 * @param statements - The prepared statements.
 * @returns The purge method.
 */
function purger(
  database: Database,
  statements: ReturnType<typeof binStatements>,
): ConversationBinRepository['purge'] {
  return database.transaction((conversationId: string): boolean => {
    if (!statements.binned.get(conversationId)) return false;
    statements.removeFollowUps.run(conversationId);
    statements.removeFirst.run(conversationId);
    return true;
  });
}

/**
 * Creates the bin's repository over an open database.
 *
 * @param database - A database the migrations have run on.
 * @returns The repository.
 */
export function createConversationBinRepository(database: Database): ConversationBinRepository {
  const statements = binStatements(database);
  return {
    bin: (conversationId, at, actor) => statements.bin.run(conversationId, actor, at).changes > 0,
    restore: (conversationId) => statements.restore.run(conversationId).changes > 0,
    get: (conversationId) => statements.get.get(conversationId) ?? undefined,
    list: () => statements.list.all(),
    binnedBefore: (before) => statements.before.all(before).map((row) => row.id),
    purge: purger(database, statements),
  };
}
