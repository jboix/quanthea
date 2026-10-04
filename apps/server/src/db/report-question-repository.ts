/**
 * Reads and writes the questions asked about reports' runs. A question is stored once, with its
 * outcome, and never changed. The full-text index `report_question_fts` follows the table through
 * its triggers. A conversation is the chain of questions from a first one, on one run; each
 * question names that first one (`root_id`). Every read skips a conversation in the bin.
 */
import type { Database } from 'bun:sqlite';
import { outsideBin } from './conversation-bin.ts';
import {
  type ConversationQueries,
  type ConversationTables,
  conversationQueries,
  matchOf,
} from './conversation-queries.ts';
import type { QuestionHit } from './question-repository.ts';

/** Where the conversations about runs are stored. */
export const runConversationTables: ConversationTables = {
  questions: 'report_questions',
  fts: 'report_question_fts',
  scope: 'run_id',
  bin: 'report_conversation_bin',
};

/** A question about a run as stored, its JSON parsed but not validated. */
export interface ReportQuestionRow {
  /** The id, a ULID. */
  readonly id: string;
  /** The report. */
  readonly reportId: string;
  /** The run. */
  readonly runId: string;
  /** The question it follows up on. */
  readonly parentId: string | null;
  /** The first question of its conversation: its own id for a first question. */
  readonly rootId: string;
  /** The time zone of the answer. */
  readonly timeZone: string;
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
  /** What the answer proposed to watch next. */
  readonly followUps: unknown;
  /** The tokens by model. */
  readonly usage: unknown;
  /** The tokens, all models together. */
  readonly tokens: number;
}

/** Stores questions about runs. */
export interface ReportQuestionRepository extends ConversationQueries {
  /**
   * Stores a question with its outcome.
   *
   * @param row - The question.
   */
  insert(row: ReportQuestionRow): void;
  /**
   * Reads a question.
   *
   * @param id - The question.
   * @returns The question, or `undefined` when there is none or its conversation is in the bin.
   */
  get(id: string): ReportQuestionRow | undefined;
  /**
   * Reads a conversation's questions, in the order they were asked.
   *
   * @param runId - The run.
   * @param conversationId - The conversation's first question.
   * @returns The questions, none when the run has no such conversation.
   */
  inConversation(runId: string, conversationId: string): ReportQuestionRow[];
  /**
   * Finds a run's answered questions whose question or answer matches any of the words, as
   * prefixes. The question weighs more than the answer.
   *
   * @param runId - The run.
   * @param words - The words, letters and digits only.
   * @param limit - The most to return.
   * @returns The hits, the best first.
   */
  search(runId: string, words: readonly string[], limit: number): QuestionHit[];
}

/** A question as SQLite returns it. */
interface StoredQuestion {
  /** The id. */
  id: string;
  /** The report. */
  report_id: string;
  /** The run. */
  run_id: string;
  /** The parent question. */
  parent_id: string | null;
  /** The first question of the conversation. */
  root_id: string;
  /** The time zone. */
  time_zone: string;
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
  /** The follow-up cards, JSON. */
  follow_ups: string;
  /** The usage, JSON. */
  usage: string;
  /** The tokens. */
  tokens: number;
}

/** The columns of a question, in the order of the insert. */
const columns = `id, report_id, run_id, parent_id, root_id, time_zone, explain_only, asked_by,
  asked_at, question, answer, failure, citations, evidence, follow_ups, usage, tokens`;

/**
 * Turns a stored question into a row.
 *
 * @param stored - The stored question.
 * @returns The row.
 */
function rowOf(stored: StoredQuestion): ReportQuestionRow {
  return {
    id: stored.id,
    reportId: stored.report_id,
    runId: stored.run_id,
    parentId: stored.parent_id,
    rootId: stored.root_id,
    timeZone: stored.time_zone,
    explainOnly: stored.explain_only === 1,
    askedBy: stored.asked_by,
    askedAt: stored.asked_at,
    question: stored.question,
    answer: stored.answer,
    failure: stored.failure,
    citations: JSON.parse(stored.citations),
    evidence: JSON.parse(stored.evidence),
    followUps: JSON.parse(stored.follow_ups),
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
function valuesOf(row: ReportQuestionRow) {
  const place = [row.id, row.reportId, row.runId, row.parentId, row.rootId, row.timeZone];
  const asked = [row.explainOnly ? 1 : 0, row.askedBy, row.askedAt, row.question];
  const outcome = [row.answer, row.failure, JSON.stringify(row.citations)];
  const spent = [JSON.stringify(row.evidence), JSON.stringify(row.followUps)];
  return [...place, ...asked, ...outcome, ...spent, JSON.stringify(row.usage), row.tokens];
}

/** Keeps the questions of conversations outside the bin. */
const live = outsideBin('report_questions', runConversationTables.bin);

/**
 * Prepares the statements.
 *
 * @param database - A database the migrations have run on.
 * @returns The statements.
 */
function questionStatements(database: Database) {
  return {
    insert: database.query(
      `INSERT INTO report_questions (${columns})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    get: database.query<StoredQuestion, [string]>(
      `SELECT ${columns} FROM report_questions WHERE id = ? AND ${live}`,
    ),
    inConversation: database.query<StoredQuestion, [string, string]>(
      `SELECT ${columns} FROM report_questions WHERE run_id = ? AND root_id = ? AND ${live}
       ORDER BY asked_at, id`,
    ),
    search: database.query<QuestionHit, [string, string, number]>(
      `SELECT question_id AS id, bm25(report_question_fts, 0, 0, 3, 1) AS rank
       FROM report_question_fts JOIN report_questions ON report_questions.id = question_id
       WHERE report_question_fts MATCH ? AND report_question_fts.run_id = ?
         AND report_questions.answer IS NOT NULL AND ${live}
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
export function createReportQuestionRepository(database: Database): ReportQuestionRepository {
  const statements = questionStatements(database);
  return {
    insert: (row) => {
      statements.insert.run(...valuesOf(row));
    },
    get: (id) => {
      const stored = statements.get.get(id);
      return stored ? rowOf(stored) : undefined;
    },
    inConversation: (runId, conversationId) =>
      statements.inConversation.all(runId, conversationId).map(rowOf),
    ...conversationQueries(database, runConversationTables),
    search: (runId, words, limit) => {
      if (words.length === 0) return [];
      return statements.search.all(matchOf(words), runId, limit);
    },
  };
}
