/**
 * A run's report in evalmark's result format, so the Evals workflow can record it: each question
 * and case is a case with one trial, its failed expectations are failed checks, and the agent's
 * questions and last words make a short transcript. The provider and models are its labels.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { costOf, type TurnUsage } from '@quanthea/shared';
import type { Case, Result as EvalmarkResult, Message, Trial } from 'evalmark';
import { alertCases } from './alert-cases.ts';
import { answerCases } from './answer-cases.ts';
import { questions } from './questions.ts';
import type { EvalOutcome, Report, Result } from './report.ts';
import { reportCases } from './report-cases.ts';

/** Any question or case. */
type AnyCase = (
  | typeof questions
  | typeof answerCases
  | typeof alertCases
  | typeof reportCases
)[number];

/**
 * What a question or case asks: its question, the panel an explanation is about, or the first
 * question asked about a report's run.
 *
 * @param each - The question or case.
 * @returns The text.
 */
function questionOf(each: AnyCase): string {
  if ('question' in each) return each.question;
  if ('panelId' in each) return `Explain the panel ${each.panelId}.`;
  return each.asks[0]?.question ?? each.id;
}

/** What each question or case asks, by id. */
const asked: ReadonlyMap<string, string> = new Map(
  [...questions, ...answerCases, ...alertCases, ...reportCases].map((each) => [
    each.id,
    questionOf(each),
  ]),
);

/** The kind of each case, by the letters its id starts with. */
const kinds: readonly (readonly [RegExp, string])[] = [
  [/^q\d/, 'dashboard'],
  [/^al\d/, 'alert'],
  [/^a\d/, 'answer'],
  [/^r\d/, 'report'],
];

/**
 * A failed expectation's check id: its first words, as a slug.
 *
 * @param reason - The expectation that did not hold, such as `no dashboard was built`.
 * @returns Such as `no-dashboard-was-built`.
 */
export function checkId(reason: string): string {
  const words = reason.toLowerCase().match(/[a-z0-9]+/g) ?? ['check'];
  return words.slice(0, 6).join('-');
}

/**
 * The tokens and money of a usage, as evalmark counts them.
 *
 * @param usage - The usage, by model.
 * @returns Input tokens (fresh, cached and written), output tokens, and the cost at list price.
 */
function usageOf(usage: TurnUsage): NonNullable<Trial['usage']> {
  const all = Object.values(usage);
  const sum = (pick: (tokens: (typeof all)[number]) => number) =>
    all.reduce((total, tokens) => total + pick(tokens), 0);
  return {
    inputTokens: sum((tokens) => tokens.input + tokens.cachedInput + tokens.cacheWrite),
    outputTokens: sum((tokens) => tokens.output),
    costUsd: costOf(usage).dollars,
  };
}

/**
 * What the agent said last: a dashboard question's last words, or an answer's text.
 *
 * @param outcome - The outcome.
 * @returns The text, if there is one.
 */
function finalWords(outcome: EvalOutcome): string | undefined {
  if ('lastWords' in outcome && outcome.lastWords) return outcome.lastWords;
  if ('text' in outcome && typeof outcome.text === 'string') return outcome.text;
  return undefined;
}

/**
 * A short transcript: the question, what the agent asked, and what it said last.
 *
 * @param question - The question, if known.
 * @param outcome - The outcome.
 * @returns The messages.
 */
function transcriptOf(question: string | undefined, outcome: EvalOutcome): Message[] {
  const messages: Message[] = question === undefined ? [] : [{ role: 'user', content: question }];
  const agentAsked = 'asked' in outcome ? outcome.asked : [];
  for (const content of agentAsked) messages.push({ role: 'assistant', content });
  const last = finalWords(outcome);
  if (last !== undefined) messages.push({ role: 'assistant', content: last });
  return messages;
}

/**
 * One question's or case's trial.
 *
 * @param result - Its result.
 * @returns The trial.
 */
function trialOf({ outcome, score }: Result): Trial {
  const error = outcome.error ?? undefined;
  const output = finalWords(outcome);
  return {
    status: score.pass ? 'pass' : error ? 'error' : 'fail',
    durationMs: outcome.durationMs,
    usage: usageOf(outcome.usage),
    checks: score.reasons.map((reason) => ({ id: checkId(reason), pass: false, message: reason })),
    ...(error ? { error } : {}),
    ...(output === undefined ? {} : { output }),
    transcript: transcriptOf(asked.get(outcome.id), outcome),
  };
}

/**
 * One question or case.
 *
 * @param result - Its result.
 * @returns The case.
 */
function caseOf(result: Result): Case {
  const { id } = result.outcome;
  const question = asked.get(id);
  const kind = kinds.find(([pattern]) => pattern.test(id))?.[1];
  return {
    id,
    title: question === undefined ? id : `${id}: ${question}`,
    ...(question === undefined ? {} : { input: question }),
    ...(kind === undefined ? {} : { tags: [kind] }),
    trials: [trialOf(result)],
  };
}

/**
 * The report as an evalmark result.
 *
 * @param report - The report.
 * @returns The result.
 */
export function evalmarkResult(report: Report): EvalmarkResult {
  const { provider = 'google', model, build } = report.models;
  return {
    $schema: 'https://jboix.github.io/evalmark/schema/result.v1.json',
    version: 1,
    suite: 'quanthea',
    startedAt: report.startedAt,
    labels: { provider, model: build ?? model, 'talk-model': model },
    cases: report.results.map(caseOf),
  };
}

/**
 * Writes the report as an evalmark result, for the Evals workflow to record.
 *
 * @param dir - The reports' folder.
 * @param report - The report.
 * @returns The file's path.
 */
export function writeEvalmark(dir: string, report: Report): string {
  const path = join(dir, 'evalmark.json');
  writeFileSync(path, `${JSON.stringify(evalmarkResult(report), null, 2)}\n`);
  return path;
}
