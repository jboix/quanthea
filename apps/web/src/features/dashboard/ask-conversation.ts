/**
 * The rules of a conversation in the Ask tab, apart from React: what each question was asked
 * about, the line that says the view changed between two questions, and which answer marks the
 * charts.
 */
import {
  type DashboardQuestion,
  type DashboardSpec,
  resolveTimeRange,
  type TimeRangeExpression,
  type VariableValues,
} from '@quanthea/shared';
import type { OpenAnswer } from './ask-marks.ts';
import { absoluteRangeLabel, storedVariableWords, variableWords } from './ask-words.ts';

/** What a question is asked about: the version, the range in absolute times, the values. */
export interface AskedContext {
  /** The version. */
  readonly version: number;
  /** The range, in epoch milliseconds. */
  readonly time: { readonly from: number; readonly to: number };
  /** The time zone the range is shown in. */
  readonly timeZone: string;
  /** The variable values, such as `$env prod`. */
  readonly variables: readonly string[];
}

/** What the dashboard shows now, to ask about. */
export interface ShownView {
  /** The version shown. */
  readonly version: number;
  /** Its spec. */
  readonly spec: DashboardSpec;
  /** The range chosen, or `undefined` for the saved one. */
  readonly time: TimeRangeExpression | undefined;
  /** The variable values chosen. */
  readonly variables: VariableValues;
  /** The dashboard's time zone, else the browser's. */
  readonly timeZone: string;
  /** The current instant, which relative ranges end at. */
  readonly now: number;
}

/**
 * What a stored question was asked about.
 *
 * @param question - The question.
 * @returns Its context.
 */
export function askedContextOf(question: DashboardQuestion): AskedContext {
  const { version, time, timeZone } = question;
  return { version, time, timeZone, variables: storedVariableWords(question.variables) };
}

/**
 * What a question asked now would be about.
 *
 * @param shown - What the dashboard shows.
 * @returns The context.
 */
export function shownContextOf(shown: ShownView): AskedContext {
  const time = resolveTimeRange(shown.time ?? shown.spec.time, shown.now);
  const variables = variableWords(shown.spec, shown.variables);
  return { version: shown.version, time, timeZone: shown.timeZone, variables };
}

/**
 * Describes a context: the range, the values, and the version when asked.
 *
 * @param context - The context.
 * @param withVersion - Whether to name the version.
 * @returns Such as `v4, 27 Sep 09:00–10:00, $env prod`.
 */
export function contextWords(context: AskedContext, withVersion = false): string {
  const range = absoluteRangeLabel(context.time, context.timeZone);
  const version = withVersion ? [`v${context.version}`] : [];
  return [...version, range, ...context.variables].join(', ');
}

/**
 * The line before a question whose context differs from the one before it.
 *
 * @param previous - The context of the question before, if any.
 * @param next - The context of the question.
 * @returns Such as `Now asking about 27 Sep 09:00–10:00, $env prod`, or `undefined` when nothing
 *   shown changed, at the minute, or there is no question before.
 */
export function contextChange(
  previous: AskedContext | undefined,
  next: AskedContext,
): string | undefined {
  if (!previous) return undefined;
  const versionChanged = previous.version !== next.version;
  const sameValues = [...previous.variables].sort().join() === [...next.variables].sort().join();
  const sameRange =
    contextWords({ ...previous, variables: [] }) === contextWords({ ...next, variables: [] });
  if (!versionChanged && sameValues && sameRange) return undefined;
  return `Now asking about ${contextWords(next, versionChanged)}`;
}

/** The answer on its way or just ended, as the conversation knows it. */
export interface LiveOutcome {
  /** How it ended, once it did. */
  readonly outcome?: { readonly ok: boolean; readonly answer?: OpenAnswer['answer'] } | undefined;
}

/**
 * The answer that marks the charts: the one picked, else the one just given, else the latest
 * answered question of the conversation.
 *
 * @param questions - The conversation's questions, in the order they were asked.
 * @param picked - The question whose answer was picked, if any.
 * @param live - The answer just given, about the version shown, if any.
 * @param shownVersion - The version shown.
 * @returns The answer and its version, or `undefined` for none.
 */
export function drivingAnswer(
  questions: readonly DashboardQuestion[],
  picked: string | undefined,
  live: LiveOutcome | undefined,
  shownVersion: number,
): (OpenAnswer & { readonly questionId: string | undefined }) | undefined {
  const chosen = questions.find((question) => question.id === picked);
  if (chosen?.outcome.ok) return { questionId: chosen.id, ...openAnswerOf(chosen) };
  const liveAnswer = live?.outcome?.ok ? live.outcome.answer : undefined;
  if (liveAnswer) return { questionId: undefined, version: shownVersion, answer: liveAnswer };
  const latest = questions.findLast((question) => question.outcome.ok);
  return latest ? { questionId: latest.id, ...openAnswerOf(latest) } : undefined;
}

/**
 * The answer a stored question marks.
 *
 * @param question - An answered question.
 * @returns Its version and answer.
 */
function openAnswerOf(question: DashboardQuestion): OpenAnswer {
  const answer = question.outcome.ok ? question.outcome.answer : { citations: [], evidence: [] };
  return { version: question.version, answer };
}
