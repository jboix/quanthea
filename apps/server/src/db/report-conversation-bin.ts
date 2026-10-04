/**
 * The bin of conversations about reports' runs, as `conversation-bin.ts` is for dashboards: moving
 * a conversation in and out, listing it, and purging it with its questions. A binned conversation
 * keeps its questions and gains a row in `report_conversation_bin`; the question reads skip it.
 */
import type { Database } from 'bun:sqlite';

/** A conversation about a run in the bin. */
export interface BinnedRunConversationRow {
  /** The conversation: its first question's id. */
  readonly id: string;
  /** Its report. */
  readonly reportId: string;
  /** The report's title. */
  readonly reportTitle: string;
  /** Its run. */
  readonly runId: string;
  /** The version the run ran, for its period's name. */
  readonly version: number;
  /** The run's period, in epoch milliseconds. */
  readonly periodFrom: number;
  /** Its end. */
  readonly periodTo: number;
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

/** Stores the bin of conversations about runs. */
export interface ReportConversationBinRepository {
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
  get(conversationId: string): BinnedRunConversationRow | undefined;
  /**
   * Lists the conversations in the bin, the most recently binned first.
   *
   * @returns The conversations.
   */
  list(): BinnedRunConversationRow[];
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

/** The columns of a binned conversation, named as {@link BinnedRunConversationRow}. */
const binnedColumns = `SELECT bin.conversation_id AS id, root.report_id AS reportId,
    r.title AS reportTitle, root.run_id AS runId, run.version, run.period_from AS periodFrom,
    run.period_to AS periodTo, root.question, root.asked_by AS startedBy,
    root.asked_at AS startedAt,
    (SELECT count(*) FROM report_questions WHERE root_id = root.id) AS count,
    bin.binned_at AS binnedAt, bin.binned_by AS binnedBy
  FROM report_conversation_bin AS bin
  JOIN report_questions AS root ON root.id = bin.conversation_id
  JOIN reports AS r ON r.id = root.report_id
  JOIN report_runs AS run ON run.id = root.run_id`;

/**
 * Prepares the statements of the bin.
 *
 * @param database - A database the migrations have run on.
 * @returns The statements.
 */
function binStatements(database: Database) {
  return {
    bin: database.query<unknown, [string, string, number]>(
      `INSERT OR IGNORE INTO report_conversation_bin (conversation_id, binned_by, binned_at)
       SELECT id, ?2, ?3 FROM report_questions WHERE id = ?1 AND root_id = id`,
    ),
    restore: database.query('DELETE FROM report_conversation_bin WHERE conversation_id = ?'),
    get: database.query<BinnedRunConversationRow, [string]>(
      `${binnedColumns} WHERE bin.conversation_id = ?`,
    ),
    list: database.query<BinnedRunConversationRow, []>(
      `${binnedColumns} ORDER BY bin.binned_at DESC, bin.conversation_id DESC`,
    ),
    before: database.query<{ id: string }, [number]>(
      'SELECT conversation_id AS id FROM report_conversation_bin WHERE binned_at < ?',
    ),
    binned: database.query<{ id: string }, [string]>(
      'SELECT conversation_id AS id FROM report_conversation_bin WHERE conversation_id = ?',
    ),
    // The first question goes last: its bin row goes with it.
    removeFollowUps: database.query('DELETE FROM report_questions WHERE root_id = ?1 AND id <> ?1'),
    removeFirst: database.query('DELETE FROM report_questions WHERE id = ?'),
  };
}

/**
 * Creates the bin's repository over an open database.
 *
 * @param database - A database the migrations have run on.
 * @returns The repository.
 */
export function createReportConversationBinRepository(
  database: Database,
): ReportConversationBinRepository {
  const statements = binStatements(database);
  const purge = database.transaction((conversationId: string): boolean => {
    if (!statements.binned.get(conversationId)) return false;
    statements.removeFollowUps.run(conversationId);
    statements.removeFirst.run(conversationId);
    return true;
  });
  return {
    bin: (conversationId, at, actor) => statements.bin.run(conversationId, actor, at).changes > 0,
    restore: (conversationId) => statements.restore.run(conversationId).changes > 0,
    get: (conversationId) => statements.get.get(conversationId) ?? undefined,
    list: () => statements.list.all(),
    binnedBefore: (before) => statements.before.all(before).map((row) => row.id),
    purge,
  };
}
