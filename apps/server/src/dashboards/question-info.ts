/**
 * Stored questions and conversations as the questions service gives them: validated, with the
 * asker named by user id. The routes replace the ids with names.
 */
import {
  type Conversation,
  type DashboardQuestion,
  dashboardQuestionSchema,
} from '@quanthea/shared';
import type { QuestionRow } from '../db/question-repository.ts';

/** A stored question, naming its asker by user id. */
export type QuestionInfo = Omit<DashboardQuestion, 'askedBy'> & {
  /** The user id of whoever asked. */
  readonly askerId: string;
};

/** A conversation, naming who started it by user id. */
export type ConversationInfo = Omit<Conversation, 'startedBy'> & {
  /** The user id of whoever asked the first question. */
  readonly starterId: string;
};

/**
 * The outcome of a stored question, as the API shapes it.
 *
 * @param row - The stored question.
 * @returns The checked answer, or the failure and what was read.
 */
function outcomeOf(row: QuestionRow) {
  if (row.answer === null) return { ok: false, message: row.failure ?? '', evidence: row.evidence };
  const answer = {
    mode: 'ask',
    text: row.answer,
    citations: row.citations,
    evidence: row.evidence,
  };
  return { ok: true, answer };
}

/**
 * A stored question as the service gives it.
 *
 * @param row - The stored question.
 * @returns The question, naming its asker by id.
 */
export function infoOf(row: QuestionRow): QuestionInfo {
  const parsed = dashboardQuestionSchema.parse({
    ...row,
    conversationId: row.rootId,
    chosenTime: row.timeChosen,
    time: { from: row.timeFrom, to: row.timeTo },
    outcome: outcomeOf(row),
  });
  const { askedBy, ...rest } = parsed;
  return { ...rest, askerId: askedBy };
}
