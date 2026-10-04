/**
 * Conversations about a report's run: a first question and the questions that follow it, on one
 * run. They are listed, read and searched as conversations about a dashboard are, and a new
 * question that continues one follows up on its latest question.
 */
import { searchWords } from '../dashboards/conversations.ts';
import type { ConversationInfo } from '../dashboards/question-info.ts';
import type { ConversationRow } from '../db/conversation-queries.ts';
import type { ReportConversationBinRepository } from '../db/report-conversation-bin.ts';
import type {
  ReportQuestionRepository,
  ReportQuestionRow,
} from '../db/report-question-repository.ts';
import { AppError } from '../lib/errors.ts';

/** What the conversations about runs read: the questions' store and the bin's. */
export interface RunConversationContext {
  /** Stores the questions. */
  readonly questions: ReportQuestionRepository;
  /** The bin of conversations about runs. */
  readonly binned: Pick<ReportConversationBinRepository, 'get'>;
}

/** The most conversations History lists. */
const maxListed = 200;

/** The most conversations a search finds. */
const maxFound = 50;

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
 * Lists a run's conversations: every one, the latest activity first, or, with a text, those
 * whose questions and answers hold all its words.
 *
 * @param context - The service context.
 * @param runId - The run, already read with the reader's role.
 * @param text - The search, empty for every conversation.
 * @returns The conversations.
 */
export function listRunConversations(
  context: RunConversationContext,
  runId: string,
  text: string,
): ConversationInfo[] {
  const { questions } = context;
  const words = searchWords(text);
  if (words.length === 0)
    return questions.conversations(runId, maxListed).map((row) => summaryOf(row, null));
  return questions.searchConversations(runId, words, maxFound).flatMap((hit) => {
    const row = questions.conversation(runId, hit.id);
    const matched = questions.get(hit.questionId);
    if (!row || !matched) return [];
    return [summaryOf(row, { questionId: matched.id, question: matched.question })];
  });
}

/**
 * The stored questions of a conversation about a run, in the order they were asked.
 *
 * @param context - The service context.
 * @param runId - The run.
 * @param conversationId - The conversation's first question.
 * @returns The questions.
 * @throws {AppError} `not_found` when the run has no such conversation, `conflict` when it is in
 *   the bin.
 */
export function runQuestionsOf(
  context: RunConversationContext,
  runId: string,
  conversationId: string,
): ReportQuestionRow[] {
  const rows = context.questions.inConversation(runId, conversationId);
  const binned = context.binned.get(conversationId);
  if (binned?.runId === runId)
    throw new AppError('conflict', 'This conversation is in the bin. Restore it to continue.');
  if (rows.length === 0)
    throw new AppError('not_found', `No conversation ${conversationId} on this run.`);
  return rows;
}
