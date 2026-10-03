/**
 * Reads and writes the questions asked about dashboards. A question is stored once, with its
 * outcome, and never changed. The full-text index `question_fts` follows the table through the
 * triggers in `migrations/0004-dashboard-questions.sql`.
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
   * Lists a dashboard's questions, the newest first.
   *
   * @param dashboardId - The dashboard.
   * @param limit - The most to list.
   * @returns The questions.
   */
  list(dashboardId: string, limit: number): QuestionRow[];
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
const columns = `id, dashboard_id, version, parent_id, time_from, time_to, time_zone, variables,
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
  const place = [row.id, row.dashboardId, row.version, row.parentId];
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
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    get: database.query<StoredQuestion, [string]>(
      `SELECT ${columns} FROM dashboard_questions WHERE id = ?`,
    ),
    list: database.query<StoredQuestion, [string, number]>(
      `SELECT ${columns} FROM dashboard_questions WHERE dashboard_id = ?
       ORDER BY asked_at DESC, id DESC LIMIT ?`,
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
    list: (dashboardId, limit) => statements.list.all(dashboardId, limit).map(rowOf),
    search: (dashboardId, words, limit) => {
      if (words.length === 0) return [];
      const match = `{question answer} : (${words.map(prefixOf).join(' OR ')})`;
      return statements.search.all(match, dashboardId, limit);
    },
  };
}
