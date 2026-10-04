/**
 * Conversations about a pinned dashboard: a first question and the questions that follow it. They
 * are listed, read and searched with the role the dashboard is read with, and a new question that
 * continues one follows up on its latest question.
 */
import type { Role } from '@quanthea/shared';
import type {
  ConversationRow,
  QuestionRepository,
  QuestionRow,
} from '../db/question-repository.ts';
import { AppError } from '../lib/errors.ts';
import { get, type ServiceContext } from './context.ts';
import { type ConversationInfo, infoOf, type QuestionInfo } from './question-info.ts';

/** The most conversations History lists. */
const maxListed = 200;

/** The most conversations a search finds. */
const maxFound = 50;

/** The most words a search looks for. */
const maxWords = 8;

/** What the conversations need: the dashboards' context and the questions' store. */
export type ConversationContext = ServiceContext & { readonly questions: QuestionRepository };

/**
 * The words of a search: letters and digits, lowercase, each once.
 *
 * @param text - The text typed.
 * @returns At most {@link maxWords} words.
 */
export function searchWords(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words)].slice(0, maxWords);
}

/**
 * A conversation's row as the service gives it.
 *
 * @param row - The conversation.
 * @param match - Its question that matched a search, if any.
 * @returns The conversation, naming who started it by id.
 */
function summaryOf(row: ConversationRow, match: ConversationInfo['match']): ConversationInfo {
  const { startedBy, ...rest } = row;
  return { ...rest, starterId: startedBy, match };
}

/**
 * The conversations a search finds, the best first, each with its question that matches best.
 *
 * @param context - The service context.
 * @param dashboardId - The dashboard.
 * @param words - The words.
 * @returns The conversations.
 */
function found(context: ConversationContext, dashboardId: string, words: readonly string[]) {
  const { questions } = context;
  return questions.searchConversations(dashboardId, words, maxFound).flatMap((hit) => {
    const row = questions.conversation(dashboardId, hit.id);
    const matched = questions.get(hit.questionId);
    if (!row || !matched) return [];
    return [summaryOf(row, { questionId: matched.id, question: matched.question })];
  });
}

/**
 * Lists a dashboard's conversations: every one, the latest activity first, or, with a text, those
 * whose questions and answers hold all its words.
 *
 * @param context - The service context.
 * @param dashboardId - The dashboard.
 * @param text - The search, empty for every conversation.
 * @param role - The role the dashboard is read with.
 * @returns The conversations.
 * @throws {AppError} `not_found` for a dashboard the role may not see.
 */
export function listConversations(
  context: ConversationContext,
  dashboardId: string,
  text: string,
  role: Role,
): ConversationInfo[] {
  get(context, dashboardId, role);
  const words = searchWords(text);
  if (words.length > 0) return found(context, dashboardId, words);
  const rows = context.questions.conversations(dashboardId, maxListed);
  return rows.map((row) => summaryOf(row, null));
}

/**
 * The stored questions of a conversation, in the order they were asked.
 *
 * @param context - The service context.
 * @param dashboardId - The dashboard.
 * @param conversationId - The conversation's first question.
 * @returns The questions.
 * @throws {AppError} `not_found` when the dashboard has no such conversation.
 */
export function questionsOf(
  context: ConversationContext,
  dashboardId: string,
  conversationId: string,
): QuestionRow[] {
  const rows = context.questions.inConversation(dashboardId, conversationId);
  if (rows.length === 0)
    throw new AppError('not_found', `No conversation ${conversationId} on this dashboard.`);
  return rows;
}

/**
 * Reads a conversation.
 *
 * @param context - The service context.
 * @param dashboardId - The dashboard.
 * @param conversationId - The conversation's first question.
 * @param role - The role the dashboard is read with.
 * @returns Its questions, in the order they were asked.
 * @throws {AppError} `not_found`.
 */
export function readConversation(
  context: ConversationContext,
  dashboardId: string,
  conversationId: string,
  role: Role,
): QuestionInfo[] {
  get(context, dashboardId, role);
  return questionsOf(context, dashboardId, conversationId).map(infoOf);
}
