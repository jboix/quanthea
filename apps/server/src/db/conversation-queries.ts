/**
 * Reads conversations: the chain of questions from a first one, listed, summed up and searched.
 * The questions about dashboards and about reports' runs share the shape, each in its own tables,
 * scoped by the dashboard or the run. A conversation in the bin is skipped by every read.
 */
import type { Database } from 'bun:sqlite';
import { outsideBin } from './conversation-bin.ts';

/** Where a kind of conversation is stored. The names are constants of the code, never input. */
export interface ConversationTables {
  /** The questions' table. */
  readonly questions: string;
  /** Its full-text index, with the scope's column. */
  readonly fts: string;
  /** The column that scopes a conversation: the dashboard, or the run. */
  readonly scope: string;
  /** The bin's table. */
  readonly bin: string;
}

/** The conversations about dashboards. */
export const dashboardConversationTables: ConversationTables = {
  questions: 'dashboard_questions',
  fts: 'question_fts',
  scope: 'dashboard_id',
  bin: 'conversation_bin',
};

/** A conversation: the chain of questions from a first one. */
export interface ConversationRow {
  /** The first question's id, which names the conversation. */
  readonly id: string;
  /** The first question. */
  readonly question: string;
  /** Who asked the first question, by user id. */
  readonly startedBy: string;
  /** When, in epoch milliseconds. */
  readonly startedAt: number;
  /** How many questions it holds. */
  readonly count: number;
  /** When its latest question was asked, in epoch milliseconds. */
  readonly lastAt: number;
}

/** A conversation one of whose questions or answers shares words with a search. */
export interface ConversationHit {
  /** The conversation. */
  readonly id: string;
  /** Its question that matches best. */
  readonly questionId: string;
  /** That question's BM25 rank: lower is better. */
  readonly rank: number;
}

/** The reads of conversations. */
export interface ConversationQueries {
  /**
   * Lists the conversations of a dashboard or a run, the latest activity first.
   *
   * @param dashboardId - The dashboard, or the run.
   * @param limit - The most to list.
   * @returns The conversations.
   */
  conversations(dashboardId: string, limit: number): ConversationRow[];
  /**
   * Reads one conversation's summary.
   *
   * @param dashboardId - The dashboard, or the run.
   * @param conversationId - The conversation's first question.
   * @returns The summary, or `undefined` when there is no such conversation.
   */
  conversation(dashboardId: string, conversationId: string): ConversationRow | undefined;
  /**
   * Finds the conversations of a dashboard or a run whose questions and answers hold every word,
   * as prefixes, in any of them. The question weighs more than the answer.
   *
   * @param dashboardId - The dashboard, or the run.
   * @param words - The words, letters and digits only.
   * @param limit - The most to return.
   * @returns The hits, the best first.
   */
  searchConversations(
    dashboardId: string,
    words: readonly string[],
    limit: number,
  ): ConversationHit[];
}

/**
 * The FTS5 phrase of a word, matched as a prefix. Quoting keeps FTS5 syntax out of the search.
 *
 * @param word - A word of letters and digits.
 * @returns The phrase.
 */
function prefixOf(word: string): string {
  return `"${word.replaceAll('"', '')}"*`;
}

/**
 * The summary of each conversation, with its first question; filtered by the caller.
 *
 * @param tables - Where the conversations are stored.
 * @returns The SQL.
 */
function summariesOf(tables: ConversationTables): string {
  return `SELECT root.id, root.question, root.asked_by AS startedBy,
    root.asked_at AS startedAt, count(*) AS count, max(asked.asked_at) AS lastAt
  FROM ${tables.questions} AS asked JOIN ${tables.questions} AS root ON root.id = asked.root_id`;
}

/**
 * The FTS5 query of words, matched as prefixes in the question or the answer.
 *
 * @param words - The words.
 * @returns The query.
 */
export function matchOf(words: readonly string[]): string {
  return `{question answer} : (${words.map(prefixOf).join(' OR ')})`;
}

/**
 * The conversations every word found, each with its best question, the best first: the lowest sum
 * of the words' ranks.
 *
 * @param perWord - The hits of each word.
 * @returns The conversations, none without words.
 */
function everyWord(perWord: readonly ConversationHit[][]): ConversationHit[] {
  const [first, ...rest] = perWord;
  if (!first) return [];
  const found = rest.reduce(narrowed, first);
  return found.sort((one, other) => one.rank - other.rank);
}

/**
 * The conversations found so far that another word found too, their ranks added up.
 *
 * @param found - The conversations found so far.
 * @param hits - Another word's hits.
 * @returns The conversations both found, each keeping its best question.
 */
function narrowed(found: ConversationHit[], hits: readonly ConversationHit[]): ConversationHit[] {
  const byId = new Map(hits.map((hit) => [hit.id, hit]));
  return found.flatMap((hit) => {
    const also = byId.get(hit.id);
    return also ? [{ ...hit, rank: hit.rank + also.rank }] : [];
  });
}

/**
 * Prepares the statements of the conversation reads.
 *
 * @param database - A database the migrations have run on.
 * @param tables - Where the conversations are stored.
 * @returns The statements.
 */
function conversationStatements(database: Database, tables: ConversationTables) {
  const { questions, fts, scope } = tables;
  const live = outsideBin('asked', tables.bin);
  const summaries = summariesOf(tables);
  return {
    list: database.query<ConversationRow, [string, number]>(
      `${summaries} WHERE asked.${scope} = ? AND ${live} GROUP BY asked.root_id
       ORDER BY lastAt DESC, root.id DESC LIMIT ?`,
    ),
    one: database.query<ConversationRow, [string, string]>(
      `${summaries} WHERE asked.${scope} = ? AND asked.root_id = ? AND ${live}
       GROUP BY asked.root_id`,
    ),
    // BM25 can't run inside an aggregate, so the hits are ranked first, then grouped.
    search: database.query<ConversationHit, [string, string]>(
      `WITH hits AS MATERIALIZED (
         SELECT asked.root_id, question_id, bm25(${fts}, 0, 0, 3, 1) AS rank
         FROM ${fts} JOIN ${questions} AS asked ON asked.id = question_id
         WHERE ${fts} MATCH ? AND ${fts}.${scope} = ? AND ${live})
       SELECT root_id AS id, question_id AS questionId, min(rank) AS rank
       FROM hits GROUP BY root_id`,
    ),
  };
}

/**
 * The repository's reads of conversations.
 *
 * @param database - A database the migrations have run on.
 * @param tables - Where the conversations are stored; those about dashboards by default.
 * @returns The conversation reads.
 */
export function conversationQueries(
  database: Database,
  tables: ConversationTables = dashboardConversationTables,
): ConversationQueries {
  const { list, one, search } = conversationStatements(database, tables);
  return {
    conversations: (dashboardId, limit) => list.all(dashboardId, limit),
    conversation: (dashboardId, conversationId) =>
      one.get(dashboardId, conversationId) ?? undefined,
    searchConversations: (dashboardId, words, limit) => {
      const perWord = words.map((word) => search.all(matchOf([word]), dashboardId));
      return everyWord(perWord).slice(0, limit);
    },
  };
}
