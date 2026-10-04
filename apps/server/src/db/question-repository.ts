/**
 * Reads and writes the questions asked about dashboards. A question is stored once, with its
 * outcome, and never changed. The full-text index `question_fts` follows the table through the
 * triggers in `migrations/0004-dashboard-questions.sql`. A conversation is the chain of questions
 * from a first one; each question names that first one (`root_id`).
 */
import type { Database } from 'bun:sqlite';

/** A question as stored, its JSON parsed but not validated. */
export interface QuestionRow {
  /** The id, a ULID. */
  readonly id: string;
  /** The dashboard. */
  readonly dashboardId: string;
  /** The version shown. */
  readonly version: number;
  /** The question it follows up on. */
  readonly parentId: string | null;
  /** The first question of its conversation: its own id for a first question. */
  readonly rootId: string;
  /** The start of the range shown, in epoch milliseconds. */
  readonly timeFrom: number;
  /** The end of the range shown, in epoch milliseconds. */
  readonly timeTo: number;
  /** The time zone of the answer. */
  readonly timeZone: string;
  /** The variable values. */
  readonly variables: unknown;
  /** The ids of the hidden sets of markers. */
  readonly hiddenMarkers: unknown;
  /** Whether no source showed numbers. */
  readonly explainOnly: boolean;
  /** Who asked, by user id. */
  readonly askedBy: string;
  /** When, in epoch milliseconds. */
  readonly askedAt: number;
  /** The question. */
  readonly question: string;
  /** The answer's text, or `null` when it failed. */
  readonly answer: string | null;
  /** Why it failed, or `null` when it was answered. */
  readonly failure: string | null;
  /** The answer's citations. */
  readonly citations: unknown;
  /** Every read the model made. */
  readonly evidence: unknown;
  /** The tokens by model. */
  readonly usage: unknown;
  /** The tokens, all models together. */
  readonly tokens: number;
}

/** A question that shares words with a search, and how well: lower is better. */
export interface QuestionHit {
  /** The question. */
  readonly id: string;
  /** Its BM25 rank. */
  readonly rank: number;
}

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

/** Stores questions. */
export interface QuestionRepository {
  /**
   * Stores a question with its outcome.
   *
   * @param row - The question.
   */
  insert(row: QuestionRow): void;
  /**
   * Reads a question.
   *
   * @param id - The question.
   * @returns The question, or `undefined` when there is none.
   */
  get(id: string): QuestionRow | undefined;
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
   * Reads a conversation's questions, in the order they were asked.
   *
   * @param dashboardId - The dashboard.
   * @param conversationId - The conversation's first question.
   * @returns The questions, none when the dashboard has no such conversation.
   */
  inConversation(dashboardId: string, conversationId: string): QuestionRow[];
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
  /**
   * Finds a dashboard's answered questions whose question or answer matches any of the words, as
   * prefixes. The question weighs more than the answer.
   *
   * @param dashboardId - The dashboard.
   * @param words - The words, letters and digits only.
   * @param limit - The most to return.
   * @returns The hits, the best first.
   */
  search(dashboardId: string, words: readonly string[], limit: number): QuestionHit[];
}

/** A question as SQLite returns it. */
interface StoredQuestion {
  /** The id. */
  id: string;
  /** The dashboard. */
  dashboard_id: string;
  /** The version. */
  version: number;
  /** The parent question. */
  parent_id: string | null;
  /** The first question of the conversation. */
  root_id: string;
  /** The start of the range. */
  time_from: number;
  /** The end of the range. */
  time_to: number;
  /** The time zone. */
  time_zone: string;
  /** The variables, JSON. */
  variables: string;
  /** The hidden sets of markers, JSON. */
  hidden_markers: string;
  /** 1 when explain only. */
  explain_only: number;
  /** Who asked. */
  asked_by: string;
  /** When. */
  asked_at: number;
  /** The question. */
  question: string;
  /** The answer. */
  answer: string | null;
  /** Why it failed. */
  failure: string | null;
  /** The citations, JSON. */
  citations: string;
  /** The evidence, JSON. */
  evidence: string;
  /** The usage, JSON. */
  usage: string;
  /** The tokens. */
  tokens: number;
}

/** The columns of a question, in the order of the insert. */
const columns = `id, dashboard_id, version, parent_id, root_id, time_from, time_to, time_zone, variables,
  hidden_markers, explain_only, asked_by, asked_at, question, answer, failure, citations, evidence,
  usage, tokens`;

/**
 * Turns a stored question into a row.
 *
 * @param stored - The stored question.
 * @returns The row.
 */
function rowOf(stored: StoredQuestion): QuestionRow {
  return {
    id: stored.id,
    dashboardId: stored.dashboard_id,
    version: stored.version,
    parentId: stored.parent_id,
    rootId: stored.root_id,
    timeFrom: stored.time_from,
    timeTo: stored.time_to,
    timeZone: stored.time_zone,
    variables: JSON.parse(stored.variables),
    hiddenMarkers: JSON.parse(stored.hidden_markers),
    explainOnly: stored.explain_only === 1,
    askedBy: stored.asked_by,
    askedAt: stored.asked_at,
    question: stored.question,
    answer: stored.answer,
    failure: stored.failure,
    citations: JSON.parse(stored.citations),
    evidence: JSON.parse(stored.evidence),
    usage: JSON.parse(stored.usage),
    tokens: stored.tokens,
  };
}

/**
 * The values of a row, in the order of {@link columns}.
 *
 * @param row - The question.
 * @returns The values.
 */
function valuesOf(row: QuestionRow) {
  const place = [row.id, row.dashboardId, row.version, row.parentId, row.rootId];
  const shown = [row.timeFrom, row.timeTo, row.timeZone];
  const choices = [JSON.stringify(row.variables), JSON.stringify(row.hiddenMarkers)];
  const asked = [row.explainOnly ? 1 : 0, row.askedBy, row.askedAt, row.question];
  const outcome = [row.answer, row.failure, JSON.stringify(row.citations)];
  const spent = [JSON.stringify(row.evidence), JSON.stringify(row.usage), row.tokens];
  return [...place, ...shown, ...choices, ...asked, ...outcome, ...spent];
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
 * Prepares the statements.
 *
 * @param database - A database the migrations have run on.
 * @returns The statements.
 */
function questionStatements(database: Database) {
  return {
    insert: database.query(
      `INSERT INTO dashboard_questions (${columns})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    get: database.query<StoredQuestion, [string]>(
      `SELECT ${columns} FROM dashboard_questions WHERE id = ?`,
    ),
    inConversation: database.query<StoredQuestion, [string, string]>(
      `SELECT ${columns} FROM dashboard_questions WHERE dashboard_id = ? AND root_id = ?
       ORDER BY asked_at, id`,
    ),
    search: database.query<QuestionHit, [string, string, number]>(
      `SELECT question_id AS id, bm25(question_fts, 0, 0, 3, 1) AS rank
       FROM question_fts JOIN dashboard_questions ON dashboard_questions.id = question_id
       WHERE question_fts MATCH ? AND question_fts.dashboard_id = ?
         AND dashboard_questions.answer IS NOT NULL
       ORDER BY rank LIMIT ?`,
    ),
  };
}

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
function matchOf(words: readonly string[]): string {
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
function conversationQueries(
  database: Database,
): Pick<QuestionRepository, 'conversations' | 'conversation' | 'searchConversations'> {
  const list = database.query<ConversationRow, [string, number]>(
    `${summaries} WHERE asked.dashboard_id = ? GROUP BY asked.root_id
     ORDER BY lastAt DESC, root.id DESC LIMIT ?`,
  );
  const one = database.query<ConversationRow, [string, string]>(
    `${summaries} WHERE asked.dashboard_id = ? AND asked.root_id = ? GROUP BY asked.root_id`,
  );
  // BM25 can't run inside an aggregate, so the hits are ranked first, then grouped.
  const search = database.query<ConversationHit, [string, string]>(
    `WITH hits AS MATERIALIZED (
       SELECT asked.root_id, question_id, bm25(question_fts, 0, 0, 3, 1) AS rank
       FROM question_fts JOIN dashboard_questions AS asked ON asked.id = question_id
       WHERE question_fts MATCH ? AND question_fts.dashboard_id = ?)
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

/**
 * Creates the repository over an open database.
 *
 * @param database - A database the migrations have run on.
 * @returns The repository.
 */
export function createQuestionRepository(database: Database): QuestionRepository {
  const statements = questionStatements(database);
  return {
    insert: (row) => {
      statements.insert.run(...valuesOf(row));
    },
    get: (id) => {
      const stored = statements.get.get(id);
      return stored ? rowOf(stored) : undefined;
    },
    inConversation: (dashboardId, conversationId) =>
      statements.inConversation.all(dashboardId, conversationId).map(rowOf),
    ...conversationQueries(database),
    search: (dashboardId, words, limit) => {
      if (words.length === 0) return [];
      return statements.search.all(matchOf(words), dashboardId, limit);
    },
  };
}
