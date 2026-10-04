/**
 * Scores what the answering service gave for an answer case against what a good answer holds.
 * Pure, so a saved report can be scored again with no model call (`--rescore`).
 */
import type { AnswerCitation, TurnUsage } from '@quanthea/shared';
import type { AnswerExpectation } from './answer-cases.ts';
import type { Score } from './score.ts';

/** One read the model made, as the report keeps it. */
export interface ReadSummary {
  /** Its evidence id, such as `e1`. */
  readonly id: string;
  /** The connector it ran on. */
  readonly connector: string;
  /** The panel whose query ran, when it read a panel. */
  readonly panelId?: string;
  /** The window it ran over, ISO 8601. */
  readonly time: { readonly from: string; readonly to: string };
  /** What the model received, written out and cut short. */
  readonly result: string;
}

/** What happened when the answering service answered a case. */
export interface AnswerCaseOutcome {
  /** Marks an answer case's outcome apart from a dashboard question's. */
  readonly kind: 'answer';
  /** The case's id. */
  readonly id: string;
  /** Whether the service gave a checked answer. */
  readonly ok: boolean;
  /** The answer's text, when it gave one. */
  readonly text?: string;
  /** Why there is no answer, when there is none. */
  readonly message?: string;
  /** The answer's citations. */
  readonly citations: readonly AnswerCitation[];
  /** Every read the model made. */
  readonly evidence: readonly ReadSummary[];
  /** The model's tool calls, by tool name. */
  readonly toolCalls: Readonly<Record<string, number>>;
  /** How many model steps it took. */
  readonly steps: number;
  /** The tokens spent, by model. */
  readonly usage: TurnUsage;
  /** How long it took, in milliseconds. */
  readonly durationMs: number;
  /** Why the call failed before any outcome, such as a bad range. */
  readonly error?: string;
}

/** Clock times, dates and years: numbers that place an answer in time, not measurements. */
const placings = [
  /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/g,
  /\b\d{1,2}:\d{2}(?::\d{2})?\b/g,
  /\b(?:19|20)\d{2}\b/g,
];

/** Citation markers such as `[1]`. */
const markers = /\[\d+\]/g;

/** Whether a text holds a citation marker. */
const hasMarker = /\[\d+\]/;

/**
 * What reads as a measurement: a percentage, a decimal, a count of four digits or more (with or
 * without thousands separators), or a number followed by what the dev data counts.
 */
const measurements = [
  /\d+(?:[.,]\d+)?\s*(?:%|percent\b)/gi,
  /\b\d+\.\d+\b/g,
  /\b\d{1,3}(?:,\d{3})+\b|\b\d{4,}\b/g,
  /\b\d+\s+(?:orders?|requests?|errors?|failures?|deploys?)\b/gi,
];

/**
 * The numbers of a text that look like measurements from the data. Clock times, dates, years and
 * citation markers are removed first; numbers inside a word, such as `5xx`, `p95` or `[1m]`, never
 * match. It is a heuristic: it misses a bare small count, such as "3".
 *
 * @param text - The text.
 * @returns The matches, in the order the patterns find them.
 */
export function dataNumbers(text: string): string[] {
  let rest = text.replace(markers, ' ');
  for (const pattern of placings) rest = rest.replace(pattern, ' ');
  const found: string[] = [];
  for (const pattern of measurements) {
    for (const match of rest.matchAll(pattern)) found.push(match[0].trim());
    rest = rest.replace(pattern, ' ');
  }
  return found;
}

/** A clock time, such as "14:02". */
const clockTime = /\b\d{1,2}:\d{2}\b/g;

/**
 * Whether a text places what happened in time: two clock times at least, such as a range ("14:02
 * to 14:38") or a start and a peak ("at 14:02 … peaking around 14:14").
 *
 * @param text - The answer's text.
 * @returns Whether it names two times.
 */
function placesInTime(text: string): boolean {
  return (text.match(clockTime) ?? []).length >= 2;
}

/** Words that say the answer cannot do something, such as read the numbers. */
const cannotRead = /\b(?:cannot|can't|can’t|can not|unable to|not able to|no access)\b/i;

/**
 * A topic pattern, for a reason: its alternatives joined with "or".
 *
 * @param topic - The pattern.
 * @returns The words.
 */
function topicWords(topic: RegExp): string {
  return topic.source.split('|').join(' or ');
}

/**
 * The reads a case made against what it should: some, or none at all.
 *
 * @param outcome - What the service gave.
 * @param expect - What a good answer holds.
 * @returns The reasons.
 */
function readFaults(outcome: AnswerCaseOutcome, expect: AnswerExpectation): string[] {
  const reads = outcome.toolCalls.read_data ?? 0;
  if (expect.reads === 'none' && (reads > 0 || outcome.evidence.length > 0))
    return [`read data ${reads} times, expected no read`];
  if (expect.reads !== 'some') return [];
  if (reads === 0) return ['read no data'];
  const known = new Set(outcome.evidence.map((read) => read.id));
  const cited = outcome.citations.some((citation) => known.has(citation.evidenceId ?? ''));
  return cited ? [] : ['no citation points at a read'];
}

/**
 * The topics the text never mentions.
 *
 * @param text - The answer's text.
 * @param expect - What a good answer holds.
 * @returns The reasons.
 */
function missingTopics(text: string, expect: AnswerExpectation): string[] {
  return expect.topics
    .filter((topic) => !topic.test(text))
    .map((topic) => `the text never mentions ${topicWords(topic)}`);
}

/**
 * What the text should say and does not: that it cannot read the numbers, and when it happened.
 *
 * @param text - The answer's text.
 * @param expect - What a good answer holds.
 * @returns The reasons.
 */
function unsaid(text: string, expect: AnswerExpectation): string[] {
  const reasons: string[] = [];
  if (expect.admitsNoData && !cannotRead.test(text))
    reasons.push('the text does not say it cannot read the numbers');
  if (expect.timeRange && !placesInTime(text)) reasons.push('the text names no two times');
  return reasons;
}

/**
 * What the text holds that it should not: measurements from the data, and citations.
 *
 * @param text - The answer's text.
 * @param outcome - What the service gave, for its citations.
 * @param expect - What a good answer holds.
 * @returns The reasons.
 */
function overSaid(text: string, outcome: AnswerCaseOutcome, expect: AnswerExpectation): string[] {
  const reasons: string[] = [];
  const numbers = expect.noDataNumbers ? dataNumbers(text) : [];
  if (numbers.length > 0) reasons.push(`the text quotes data: ${numbers.join(', ')}`);
  if (expect.noCitations && (hasMarker.test(text) || outcome.citations.length > 0))
    reasons.push('the text carries citation markers');
  return reasons;
}

/**
 * Scores an answer case's outcome.
 *
 * @param outcome - What the service gave.
 * @param expect - What a good answer holds.
 * @returns Pass or not, and why not.
 */
export function scoreAnswer(outcome: AnswerCaseOutcome, expect: AnswerExpectation): Score {
  if (outcome.error !== undefined)
    return { pass: false, reasons: [`the call failed: ${outcome.error}`] };
  if (!outcome.ok || outcome.text === undefined)
    return { pass: false, reasons: [`no answer: ${outcome.message ?? 'no reason given'}`] };
  const { text } = outcome;
  const reasons = [
    ...readFaults(outcome, expect),
    ...missingTopics(text, expect),
    ...unsaid(text, expect),
    ...overSaid(text, outcome, expect),
  ];
  return { pass: reasons.length === 0, reasons };
}

/**
 * Whether an outcome is an answer case's, rather than a dashboard question's.
 *
 * @param outcome - The outcome.
 * @returns Whether it is an answer case's.
 */
export function isAnswer<Other extends object>(
  outcome: AnswerCaseOutcome | Other,
): outcome is AnswerCaseOutcome {
  return 'kind' in outcome && outcome.kind === 'answer';
}
