/**
 * Reads the conversations about dashboards: the chain of questions from a first one, listed,
 * summed up and searched. A conversation in the bin is skipped by every read.
 */
import type { Database } from 'bun:sqlite';
import { outsideBin } from './conversation-bin.ts';

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
   * Lists a dashboard's conversations, the latest activity first.
   *
   * @param dashboardId - The dashboard.
   * @param limit - The most to list.
   * @returns The conversations.
   */
  conversations(dashboardId: string, limit: number): ConversationRow[];
  /**
   * Reads one conversation's summary.
   *
   * @param dashboardId - The dashboard.
   * @param conversationId - The conversation's first question.
   * @returns The summary, or `undefined` when the dashboard has no such conversation.
   */
  conversation(dashboardId: string, conversationId: string): ConversationRow | undefined;
  /**
   * Finds a dashboard's conversations whose questions and answers hold every word, as prefixes,
   * in any of them. The question weighs more than the answer.
   *
   * @param dashboardId - The dashboard.
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

/** Keeps the questions of conversations outside the bin. */
const live = outsideBin('asked');

/** The summary of each conversation, with its first question; filtered by the caller. */
const summaries = `SELECT root.id, root.question, root.asked_by AS startedBy,
    root.asked_at AS startedAt, count(*) AS count, max(asked.asked_at) AS lastAt
  FROM dashboard_questions AS asked JOIN dashboard_questions AS root ON root.id = asked.root_id`;

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
 * The repository's reads of conversations.
 *
 * @param database - A database the migrations have run on.
 * @returns The conversation reads.
 */
export function conversationQueries(database: Database): ConversationQueries {
  const list = database.query<ConversationRow, [string, number]>(
    `${summaries} WHERE asked.dashboard_id = ? AND ${live} GROUP BY asked.root_id
     ORDER BY lastAt DESC, root.id DESC LIMIT ?`,
  );
  const one = database.query<ConversationRow, [string, string]>(
    `${summaries} WHERE asked.dashboard_id = ? AND asked.root_id = ? AND ${live}
     GROUP BY asked.root_id`,
  );
  // BM25 can't run inside an aggregate, so the hits are ranked first, then grouped.
  const search = database.query<ConversationHit, [string, string]>(
    `WITH hits AS MATERIALIZED (
       SELECT asked.root_id, question_id, bm25(question_fts, 0, 0, 3, 1) AS rank
       FROM question_fts JOIN dashboard_questions AS asked ON asked.id = question_id
       WHERE question_fts MATCH ? AND question_fts.dashboard_id = ? AND ${live})
     SELECT root_id AS id, question_id AS questionId, min(rank) AS rank
     FROM hits GROUP BY root_id`,
  );
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
