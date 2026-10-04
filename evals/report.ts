/**
 * The report of a run: each question's outcome and score, the models, the cache's hits, and a
 * table to read. A report keeps the outcomes, so it can be scored again with no model call, and
 * two reports can be compared.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addUsage, costOf, type TokenUsage, type TurnUsage } from '@quanthea/shared';
import { alertCases } from './alert-cases.ts';
import { type AlertCaseOutcome, isAlert, scoreAlert } from './alert-score.ts';
import { answerCases } from './answer-cases.ts';
import { type AnswerCaseOutcome, isAnswer, scoreAnswer } from './answer-score.ts';
import type { CacheCounts } from './cache.ts';
import { questions } from './questions.ts';
import { type Outcome, type Score, score } from './score.ts';
import type { EvalModels } from './setup.ts';

/** What happened for a dashboard question, an answer case or an alert case. */
export type EvalOutcome = Outcome | AnswerCaseOutcome | AlertCaseOutcome;

/** One question's or answer case's result. */
export interface Result {
  /** What happened. */
  readonly outcome: EvalOutcome;
  /** How it scored. */
  readonly score: Score;
}

/** A run's report. */
export interface Report {
  /** When the run started, as ISO 8601. */
  readonly startedAt: string;
  /** The models it used. */
  readonly models: EvalModels;
  /** How many responses came from the cache, and how many from the provider. */
  readonly cache: CacheCounts;
  /** Each question's result, in order. */
  readonly results: readonly Result[];
}

/** The score of an outcome whose question or case is gone. */
const gone: Score = { pass: false, reasons: ['the question is gone'] };

/**
 * Scores one outcome against its question or answer case as it is now.
 *
 * @param outcome - The outcome.
 * @returns The score.
 */
function scoreOne(outcome: EvalOutcome): Score {
  if (isAlert(outcome)) {
    const alertCase = alertCases.find((each) => each.id === outcome.id);
    return alertCase ? scoreAlert(outcome, alertCase.expect) : gone;
  }
  if (isAnswer(outcome)) {
    const answerCase = answerCases.find((each) => each.id === outcome.id);
    return answerCase ? scoreAnswer(outcome, answerCase.expect) : gone;
  }
  const question = questions.find((each) => each.id === outcome.id);
  return question ? score(outcome, question.expect) : gone;
}

/**
 * Scores outcomes against the questions and the answer cases as they are now.
 *
 * @param outcomes - The outcomes.
 * @returns The results.
 */
export function scoreAll(outcomes: readonly EvalOutcome[]): Result[] {
  return outcomes.map((outcome) => ({ outcome, score: scoreOne(outcome) }));
}

/**
 * Writes a report as JSON in the reports folder.
 *
 * @param dir - The folder.
 * @param report - The report.
 * @returns The file's path.
 */
export function writeReport(dir: string, report: Report): string {
  mkdirSync(dir, { recursive: true });
  const stamp = report.startedAt.slice(0, 16).replace(':', '-');
  const path = join(dir, `${stamp}-${report.models.model}.json`);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}

/**
 * Reads a report.
 *
 * @param path - Its file.
 * @returns The report.
 */
export function readReport(path: string): Report {
  return JSON.parse(readFileSync(path, 'utf8')) as Report;
}

/**
 * Every token of a usage.
 *
 * @param usage - The usage, by model.
 * @returns The total.
 */
export function tokensOf(usage: TurnUsage): number {
  return Object.values(usage).reduce(
    (sum, tokens) => sum + tokens.input + tokens.cachedInput + tokens.cacheWrite + tokens.output,
    0,
  );
}

/**
 * The usage of every question together.
 *
 * @param results - The results.
 * @returns The usage, by model.
 */
export function totalUsage(results: readonly Result[]): TurnUsage {
  let total: TurnUsage = {};
  for (const { outcome } of results)
    for (const [model, tokens] of Object.entries(outcome.usage))
      total = addUsage(total, model, tokens as TokenUsage);
  return total;
}

/**
 * Dollars at list price, with a note when a model has no price.
 *
 * @param usage - The usage.
 * @returns Such as `$0.0123`.
 */
export function dollars(usage: TurnUsage): string {
  const { dollars: amount, unpriced } = costOf(usage);
  return `$${amount.toFixed(4)}${unpriced.length > 0 ? ' (some unpriced)' : ''}`;
}

/**
 * Where the model's answers came from, in words: the cache or the provider.
 *
 * @param cache - The cache's hits and misses.
 * @returns The sentence.
 */
export function cacheSentence({ hits, misses }: CacheCounts): string {
  if (hits + misses === 0) return 'No model was called.';
  if (misses === 0)
    return `All ${hits} model answers came from the cache: no call to the provider.`;
  if (hits === 0)
    return `All ${misses} model answers came from the provider: the cache had none of these requests yet. A rerun on the same day replays the answers that did not change.`;
  return `${hits} model answers came from the cache, ${misses} from the provider.`;
}

/**
 * A count with its noun, such as `1 panel` or `2 panels`.
 *
 * @param count - The count.
 * @param one - The noun, singular.
 * @param many - The noun, plural.
 * @returns The phrase.
 */
export function counted(count: number, one: string, many: string): string {
  return `${count.toLocaleString('en')} ${count === 1 ? one : many}`;
}

/**
 * The reads an answer case made: its `read_data` calls.
 *
 * @param outcome - The answer case's outcome.
 * @returns How many.
 */
export function readsOf(outcome: AnswerCaseOutcome): number {
  return outcome.toolCalls.read_data ?? 0;
}

/**
 * What an outcome made, in two counts: panels and repairs, reads and model steps, or alert
 * versions and repairs.
 *
 * @param outcome - The outcome.
 * @returns The two phrases.
 */
export function madeOf(outcome: EvalOutcome): readonly [string, string] {
  if (isAlert(outcome))
    return [
      counted(outcome.versions, 'version', 'versions'),
      counted(outcome.repairs, 'repair', 'repairs'),
    ];
  if (isAnswer(outcome))
    return [counted(readsOf(outcome), 'read', 'reads'), counted(outcome.steps, 'step', 'steps')];
  return [
    counted(outcome.panels.length, 'panel', 'panels'),
    counted(outcome.repairs, 'repair', 'repairs'),
  ];
}

/**
 * One line of the table.
 *
 * @param result - A question's or answer case's result.
 * @returns The line.
 */
function line({ outcome, score: scored }: Result): string {
  const [made, spent] = madeOf(outcome);
  const cells = [
    outcome.id.padEnd(4),
    (scored.pass ? 'pass' : 'FAIL').padEnd(4),
    made.padEnd(10),
    spent.padEnd(10),
    `${tokensOf(outcome.usage)} tokens`.padEnd(14),
    dollars(outcome.usage).padEnd(10),
    `${Math.round(outcome.durationMs / 1000)} s`.padEnd(6),
  ];
  return `${cells.join('  ')}  ${scored.reasons.join('; ')}`.trimEnd();
}

/**
 * The report as a table, with the totals.
 *
 * @param report - The report.
 * @returns The text.
 */
export function summary(report: Report): string {
  const passed = report.results.filter((result) => result.score.pass).length;
  const usage = totalUsage(report.results);
  const { build, model } = report.models;
  const models = build ? `${model}, building with ${build}` : model;
  return [
    `Evals of ${report.startedAt} on ${models}`,
    '',
    ...report.results.map(line),
    '',
    `${passed} of ${report.results.length} pass · ${tokensOf(usage)} tokens · ${dollars(usage)} at list price`,
    cacheSentence(report.cache),
  ].join('\n');
}

/**
 * How one question changed from a report to the next.
 *
 * @param before - Its result before, if it ran.
 * @param after - Its result after, if it ran.
 * @returns The line.
 */
function change(before: Result | undefined, after: Result | undefined): string {
  const verdict = (result: Result | undefined) =>
    result === undefined ? '—' : result.score.pass ? 'pass' : 'FAIL';
  const tokens = (result: Result | undefined) => (result ? tokensOf(result.outcome.usage) : 0);
  const id = (before ?? after)?.outcome.id ?? '';
  const delta = tokens(after) - tokens(before);
  return `${id.padEnd(4)}  ${verdict(before)} → ${verdict(after)}  tokens ${delta >= 0 ? '+' : ''}${delta}`;
}

/**
 * Two reports side by side: each question's verdict and tokens, then the totals.
 *
 * @param before - The earlier report.
 * @param after - The later report.
 * @returns The text.
 */
export function comparison(before: Report, after: Report): string {
  const ids = [
    ...new Set([...before.results, ...after.results].map((result) => result.outcome.id)),
  ];
  const find = (report: Report, id: string) =>
    report.results.find((result) => result.outcome.id === id);
  const passed = (report: Report) => report.results.filter((result) => result.score.pass).length;
  return [
    `${before.startedAt} (${before.models.model}) → ${after.startedAt} (${after.models.model})`,
    '',
    ...ids.map((id) => change(find(before, id), find(after, id))),
    '',
    `pass ${passed(before)} → ${passed(after)} · cost ${dollars(totalUsage(before.results))} → ${dollars(totalUsage(after.results))}`,
  ].join('\n');
}
