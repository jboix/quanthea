/**
 * The checks of the answers about a report's run, and the evidence they read: an answer the
 * server checked, the frozen reads it cites, what its text mentions, the numbers it must not quote,
 * and the follow-up cards. Each check is one assertion about one answer, pure, so a saved report
 * can be scored again with no model call (`--rescore`).
 */
import type { AnswerCitation, FollowUp, TurnUsage } from '@quanthea/shared';
import type { Check } from '../core/case.ts';
import { cannotRead, dataNumbers, type ReadSummary } from './answer.ts';
import { topicWords } from './dashboard.ts';

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

/** A check of the answers about a report's run. */
export type RunAnswerCheck = Check<RunAnswerCaseOutcome>;

/**
 * What a fault starts with: which answer it is about, when the conversation has more than one.
 *
 * @param outcome - What the service gave.
 * @param at - Which answer, from 1.
 * @returns Such as `answer 2: `, or nothing.
 */
function named(outcome: RunAnswerCaseOutcome, at: number): string {
  return at > 1 || outcome.answers.length > 1 ? `answer ${at}: ` : '';
}

/** Every question was asked and got an answer the server checked. Nothing else can be checked without them. */
export const everyAnswerGiven: RunAnswerCheck = {
  id: 'every-answer-given',
  kind: 'structure',
  gate: true,
  faults: (outcome) =>
    outcome.answers.flatMap((answer, index) =>
      answer.ok && answer.text !== undefined
        ? []
        : [`${named(outcome, index + 1)}no answer: ${answer.message ?? 'no reason given'}`],
    ),
};

/** The checks every run-answer case runs before its own. */
export const runAnswerDefaults: readonly RunAnswerCheck[] = [everyAnswerGiven];

/**
 * A check of one answer of the conversation.
 *
 * @param id - The check's name.
 * @param kind - How it decides.
 * @param at - Which answer, from 1.
 * @param faults - What does not hold in the answer.
 * @returns The check; its faults name the answer. A legacy check stands in for a rubric.
 */
function onAnswer(
  id: string,
  kind: RunAnswerCheck['kind'],
  at: number,
  faults: (answer: RunAnswer, text: string) => readonly string[],
): RunAnswerCheck {
  const read = (outcome: RunAnswerCaseOutcome) => {
    const answer = outcome.answers[at - 1];
    const found = answer ? faults(answer, answer.text ?? '') : ['the question was not asked'];
    return found.map((fault) => `${named(outcome, at)}${fault}`);
  };
  const standsInFor = kind === 'legacy' ? { standsInFor: 'rubric' as const } : {};
  return { id: `answer-${at}:${id}`, kind, ...standsInFor, faults: read };
}

/**
 * A citation of an answer points at a read of the run's frozen results.
 *
 * @param at - Which answer, from 1.
 * @returns The check.
 */
export function citesFrozenRead(at: number): RunAnswerCheck {
  return onAnswer('cites-frozen-read', 'structure', at, (answer) => {
    const frozen = new Set(answer.evidence.filter((read) => read.frozen).map((read) => read.id));
    if (frozen.size === 0) return ['read none of the run’s frozen results'];
    const cited = answer.citations.some((citation) => frozen.has(citation.evidenceId ?? ''));
    return cited ? [] : ['no citation points at a frozen read'];
  });
}

/**
 * An answer carries one to three follow-up cards, each with a prompt.
 *
 * @param at - Which answer, from 1.
 * @returns The check.
 */
export function offersFollowUps(at: number): RunAnswerCheck {
  return onAnswer('offers-follow-ups', 'feature', at, (answer) => {
    const count = answer.followUps.length;
    if (count < 1 || count > 3) return [`${count} follow-up cards, expected 1 to 3`];
    const empty = answer.followUps.filter((card) => card.prompt.trim() === '');
    return empty.length > 0 ? ['a follow-up card has no prompt'] : [];
  });
}

/**
 * A pattern matches an answer's text. It stands in for a reading of what the answer says, until a
 * rubric does it.
 *
 * @param at - Which answer, from 1.
 * @param pattern - The pattern.
 * @returns The check.
 */
export function mentions(at: number, pattern: RegExp): RunAnswerCheck {
  return onAnswer(`mentions:${pattern.source}`, 'legacy', at, (_answer, text) =>
    pattern.test(text) ? [] : [`the text never mentions ${topicWords(pattern)}`],
  );
}

/**
 * An answer says it cannot read the numbers, or that it sees only their shape, by its words.
 *
 * @param at - Which answer, from 1.
 * @returns The check.
 */
export function admitsNoData(at: number): RunAnswerCheck {
  return onAnswer('admits-no-data', 'legacy', at, (_answer, text) =>
    cannotRead.test(text) || shapesOnly.test(text)
      ? []
      : ['the text does not say it cannot read the numbers'],
  );
}

/**
 * An answer quotes no measurement from the data (see `dataNumbers`).
 *
 * @param at - Which answer, from 1.
 * @returns The check.
 */
export function quotesNoData(at: number): RunAnswerCheck {
  return onAnswer('quotes-no-data', 'feature', at, (_answer, text) => {
    const numbers = dataNumbers(text);
    return numbers.length > 0 ? [`the text quotes data: ${numbers.join(', ')}`] : [];
  });
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
