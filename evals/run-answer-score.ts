/**
 * Scores what the answering service gave about a report's run against what a good answer holds:
 * an answer the server checked, the frozen reads it cites, what its text mentions, the numbers it
 * must not quote, and the follow-up cards. Pure, so a saved report can be scored again with no
 * model call (`--rescore`).
 */
import type { AnswerCitation, FollowUp, TurnUsage } from '@quanthea/shared';
import { cannotRead, dataNumbers, type ReadSummary } from './answer-score.ts';
import type { RunAnswerExpectation } from './report-cases.ts';
import type { Score } from './score.ts';

/** One read of an answer about a run: a read's summary, and whether it read the frozen run. */
export interface RunReadSummary extends ReadSummary {
  /** Whether it read the run's frozen results (`read_run`) rather than querying again. */
  readonly frozen: boolean;
}

/** One answer of a run case. */
export interface RunAnswer {
  /** What the person asked. */
  readonly question: string;
  /** Whether the service gave a checked answer. */
  readonly ok: boolean;
  /** The answer's text, when it gave one. */
  readonly text?: string;
  /** Why there is no answer, when there is none. */
  readonly message?: string;
  /** The answer's citations. */
  readonly citations: readonly AnswerCitation[];
  /** Every read the model made. */
  readonly evidence: readonly RunReadSummary[];
  /** The follow-up cards the answer carries. */
  readonly followUps: readonly FollowUp[];
  /** The model's tool calls, by tool name. */
  readonly toolCalls: Readonly<Record<string, number>>;
  /** How many model steps it took. */
  readonly steps: number;
}

/** What happened when the answering service answered a run case. */
export interface RunAnswerCaseOutcome {
  /** Marks a run case's outcome apart from the others. */
  readonly kind: 'run-answer';
  /** The case's id. */
  readonly id: string;
  /** The run's period, in words, such as `Sat 3 Oct`. */
  readonly period?: string;
  /** Each answer, in the order asked. */
  readonly answers: readonly RunAnswer[];
  /** The tokens spent, by model, over every answer. */
  readonly usage: TurnUsage;
  /** How long it took, in milliseconds. */
  readonly durationMs: number;
  /** Why the case failed before every answer, such as a run that is missing. */
  readonly error?: string;
}

/** Words that say the answer sees the results' shape but not their numbers. */
const shapesOnly =
  /\b(?:not|never|without|no)\s+(?:the\s+|their\s+|any\s+)?(?:numbers|values)\b|\bshapes?\b/i;

/**
 * What is wrong with the reads: some citation must point at a frozen read.
 *
 * @param answer - The answer.
 * @returns The reasons.
 */
function frozenFaults(answer: RunAnswer): string[] {
  const frozen = new Set(answer.evidence.filter((read) => read.frozen).map((read) => read.id));
  if (frozen.size === 0) return ['read none of the run’s frozen results'];
  const cited = answer.citations.some((citation) => frozen.has(citation.evidenceId ?? ''));
  return cited ? [] : ['no citation points at a frozen read'];
}

/**
 * What is wrong with the follow-up cards: one to three, each with a prompt.
 *
 * @param answer - The answer.
 * @returns The reasons.
 */
function followUpFaults(answer: RunAnswer): string[] {
  const count = answer.followUps.length;
  if (count < 1 || count > 3) return [`${count} follow-up cards, expected 1 to 3`];
  const empty = answer.followUps.filter((card) => card.prompt.trim() === '');
  return empty.length > 0 ? ['a follow-up card has no prompt'] : [];
}

/**
 * What the text says that it should not, and does not say that it should.
 *
 * @param text - The answer's text.
 * @param expect - What a good answer holds.
 * @returns The reasons.
 */
function textFaults(text: string, expect: RunAnswerExpectation): string[] {
  const reasons = expect.topics
    .filter((topic) => !topic.test(text))
    .map((topic) => `the text never mentions ${topic.source.split('|').join(' or ')}`);
  if (expect.admitsNoData && !cannotRead.test(text) && !shapesOnly.test(text))
    reasons.push('the text does not say it cannot read the numbers');
  const numbers = expect.noDataNumbers ? dataNumbers(text) : [];
  if (numbers.length > 0) reasons.push(`the text quotes data: ${numbers.join(', ')}`);
  return reasons;
}

/**
 * Scores one answer of a run case.
 *
 * @param answer - The answer.
 * @param expect - What a good answer holds.
 * @returns The reasons it falls short.
 */
function answerFaults(answer: RunAnswer, expect: RunAnswerExpectation): string[] {
  if (!answer.ok || answer.text === undefined)
    return [`no answer: ${answer.message ?? 'no reason given'}`];
  return [
    ...(expect.citesFrozenRead ? frozenFaults(answer) : []),
    ...textFaults(answer.text, expect),
    ...(expect.followUps ? followUpFaults(answer) : []),
  ];
}

/**
 * Scores a run case's outcome: every answer, each against its expectation. A reason names the
 * question when the case asks more than one.
 *
 * @param outcome - What the service gave.
 * @param expects - What each good answer holds, in the order asked.
 * @returns Pass or not, and why not.
 */
export function scoreRunAnswer(
  outcome: RunAnswerCaseOutcome,
  expects: readonly RunAnswerExpectation[],
): Score {
  if (outcome.error !== undefined)
    return { pass: false, reasons: [`the case failed: ${outcome.error}`] };
  const reasons = expects.flatMap((expect, index) => {
    const answer = outcome.answers[index];
    const faults = answer ? answerFaults(answer, expect) : ['the question was not asked'];
    return expects.length > 1 ? faults.map((fault) => `answer ${index + 1}: ${fault}`) : faults;
  });
  return { pass: reasons.length === 0, reasons };
}

/**
 * Whether an outcome is a run case's.
 *
 * @param outcome - The outcome.
 * @returns Whether it is a run case's.
 */
export function isRunAnswer<Other extends object>(
  outcome: RunAnswerCaseOutcome | Other,
): outcome is RunAnswerCaseOutcome {
  return 'kind' in outcome && outcome.kind === 'run-answer';
}
