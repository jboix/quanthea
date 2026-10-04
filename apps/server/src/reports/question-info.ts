/**
 * Stored questions about runs as the service gives them: validated, with the asker named by user
 * id. The routes replace the ids with names.
 */
import { type RunQuestion, runQuestionSchema } from '@quanthea/shared';
import type { ReportQuestionRow } from '../db/report-question-repository.ts';

/** A stored question about a run, naming its asker by user id. */
export type RunQuestionInfo = Omit<RunQuestion, 'askedBy'> & {
  /** The user id of whoever asked. */
  readonly askerId: string;
};

/**
 * The outcome of a stored question, as the API shapes it: the answer carries its follow-up cards.
 *
 * @param row - The stored question.
 * @returns The checked answer, or the failure and what was read.
 */
function outcomeOf(row: ReportQuestionRow) {
  if (row.answer === null) return { ok: false, message: row.failure ?? '', evidence: row.evidence };
  const answer = {
    mode: 'ask',
    text: row.answer,
    citations: row.citations,
    evidence: row.evidence,
    followUps: row.followUps,
  };
  return { ok: true, answer };
}

/**
 * A stored question about a run as the service gives it.
 *
 * @param row - The stored question.
 * @returns The question, naming its asker by id.
 */
export function runQuestionInfo(row: ReportQuestionRow): RunQuestionInfo {
  const parsed = runQuestionSchema.parse({
    ...row,
    conversationId: row.rootId,
    outcome: outcomeOf(row),
  });
  const { askedBy, ...rest } = parsed;
  return { ...rest, askerId: askedBy };
}
