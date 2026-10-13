/**
 * The checks of an answer or an explanation, and the evidence they read. Each check is one
 * assertion, pure, so a saved report can be scored again with no model call (`--rescore`).
 */
import type { AnswerCitation, TurnUsage } from '@quanthea/shared';
import type { Check } from '../core/case.ts';
import { topicWords } from './dashboard.ts';

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
export const cannotRead = /\b(?:cannot|can't|can’t|can not|unable to|not able to|no access)\b/i;

/** A check of an answer or an explanation. */
export type AnswerCheck = Check<AnswerCaseOutcome>;

/** The service gave an answer whose citations the server checked. Nothing else can be checked without one. */
export const answered: AnswerCheck = {
  id: 'answered',
  kind: 'structure',
  gate: true,
  faults: (outcome) =>
    outcome.ok && outcome.text !== undefined
      ? []
      : [`no answer: ${outcome.message ?? 'no reason given'}`],
};

/** The checks every answer and explanation case runs before its own. */
export const answerDefaults: readonly AnswerCheck[] = [answered];

/**
 * The reads of an answer that must read: some, and a citation that points at one.
 *
 * @param outcome - What the service gave.
 * @returns The faults.
 */
function unread(outcome: AnswerCaseOutcome): string[] {
  if ((outcome.toolCalls.read_data ?? 0) === 0) return ['read no data'];
  const known = new Set(outcome.evidence.map((read) => read.id));
  const cited = outcome.citations.some((citation) => known.has(citation.evidenceId ?? ''));
  return cited ? [] : ['no citation points at a read'];
}

/** The answer read data, and a citation points at a read. */
export const readsData: AnswerCheck = { id: 'reads-data', kind: 'structure', faults: unread };

/** The answer read no data at all: what a source that shows no numbers, or an explanation, allows. */
export const readsNothing: AnswerCheck = {
  id: 'reads-nothing',
  kind: 'feature',
  faults: (outcome) => {
    const reads = outcome.toolCalls.read_data ?? 0;
    return reads > 0 || outcome.evidence.length > 0
      ? [`read data ${reads} times, expected no read`]
      : [];
  },
};

/**
 * A pattern matches the text. It stands in for a reading of what the answer says, until a rubric
 * does it.
 *
 * @param pattern - The pattern.
 * @returns The check.
 */
export function mentions(pattern: RegExp): AnswerCheck {
  const faults = ({ text = '' }: AnswerCaseOutcome) =>
    pattern.test(text) ? [] : [`the text never mentions ${topicWords(pattern)}`];
  return { id: `mentions:${pattern.source}`, kind: 'legacy', standsInFor: 'rubric', faults };
}

/** The text says it cannot read the numbers, by its words. */
export const admitsNoData: AnswerCheck = {
  id: 'admits-no-data',
  kind: 'legacy',
  standsInFor: 'rubric',
  faults: ({ text = '' }) =>
    cannotRead.test(text) ? [] : ['the text does not say it cannot read the numbers'],
};

/** The text places what happened in time: two clock times at least. */
export const namesTwoTimes: AnswerCheck = {
  id: 'names-two-times',
  kind: 'legacy',
  standsInFor: 'rubric',
  faults: ({ text = '' }) => (placesInTime(text) ? [] : ['the text names no two times']),
};

/** The text quotes no measurement from the data (see {@link dataNumbers}). */
export const quotesNoData: AnswerCheck = {
  id: 'quotes-no-data',
  kind: 'feature',
  faults: ({ text = '' }) => {
    const numbers = dataNumbers(text);
    return numbers.length > 0 ? [`the text quotes data: ${numbers.join(', ')}`] : [];
  },
};

/** The text carries no citation marker, and the answer no citation. */
export const noCitations: AnswerCheck = {
  id: 'no-citations',
  kind: 'feature',
  faults: ({ text = '', citations }) =>
    hasMarker.test(text) || citations.length > 0 ? ['the text carries citation markers'] : [],
};

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
