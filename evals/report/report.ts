/**
 * The report of a run: each case's trials, the models, what produced the numbers, and the cache's
 * hits. A report keeps what each trial made, so it can be scored again with no model call, and two
 * reports can be compared. A report written before trials is read as one trial per case.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addUsage, costOf, type TokenUsage, type TurnUsage } from '@quanthea/shared';
import { allCases } from '../cases/index.ts';
import { isAlert } from '../checks/alert.ts';
import { type AnswerCaseOutcome, isAnswer } from '../checks/answer.ts';
import { isReport } from '../checks/report.ts';
import { isRunAnswer, type RunAnswerCaseOutcome } from '../checks/run-answer.ts';
import type { Bucket, EvalCase, Evidence } from '../core/case.ts';
import {
  type CaseResult,
  caseStatus,
  fractionOf,
  isUnstable,
  type RunVersions,
  type TrialResult,
  type TrialStatus,
} from '../core/result.ts';
import type { Skipped } from '../core/select.ts';
import { scoreTrial, unjudged } from '../core/trial.ts';
import type { CacheCounts } from '../world/cache.ts';
import type { EvalModels } from '../world/setup.ts';

/** A run's report. */
export interface Report {
  /** The format: 2 since a case has trials. */
  readonly version: 2;
  /** When the run started, as ISO 8601. */
  readonly startedAt: string;
  /** The models it used. */
  readonly models: EvalModels;
  /** What produced its numbers. */
  readonly versions: RunVersions;
  /** How many model answers came from the cache, and how many from the provider. */
  readonly cache: CacheCounts;
  /** How many verdicts came from the cache, how many from the judge, and the tokens it spent. */
  readonly judged: CacheCounts & { readonly tokens?: number };
  /** Each case's results, in order. */
  readonly results: readonly CaseResult[];
  /** The cases that were not run, with what the world lacks; absent when none. */
  readonly skipped?: readonly Skipped[];
  /**
   * The cases earlier trials showed unstable on these models, each with its fraction and day;
   * absent when none.
   */
  readonly knownUnstable?: readonly string[];
}

/** A report as written before a case had trials. */
interface OldReport {
  /** When the run started. */
  readonly startedAt: string;
  /** The models it used. */
  readonly models: EvalModels;
  /** The cache's hits and misses. */
  readonly cache: CacheCounts;
  /** Each case's outcome, with the score it had then. */
  readonly results: readonly { readonly outcome: Evidence }[];
  /** The cases that were not run. */
  readonly skipped?: readonly Skipped[];
}

/** What an old report says of what produced its numbers: nothing was recorded. */
const unrecorded: RunVersions = { judge: null, judgePrompt: 0, data: '', sample: '' };

/**
 * The case an id names, as it is now.
 *
 * @param id - The id.
 * @returns The case, if it still exists.
 */
export function caseOf(id: string): EvalCase | undefined {
  return allCases.find((each) => each.id === id);
}

/**
 * A trial scored again against its case as it is now. The judge is not called: the verdicts it
 * gave stay, for the sentences the rubric still holds.
 *
 * @param evalCase - The case.
 * @param trial - The trial.
 * @returns The trial's result.
 */
function rescored(evalCase: EvalCase, trial: TrialResult): TrialResult {
  const given = new Map(trial.verdicts.map((verdict) => [verdict.sentence, verdict]));
  const verdicts = unjudged(evalCase, 'the sentence is new: no judge read it').map(
    (blank) => given.get(blank.sentence) ?? blank,
  );
  return scoreTrial(evalCase, trial, verdicts);
}

/**
 * A case's results scored again against the case as it is now.
 *
 * @param result - The results.
 * @returns The results; unchanged when the case is gone.
 */
function rescoredCase(result: CaseResult): CaseResult {
  const evalCase = caseOf(result.id);
  if (!evalCase) return result;
  const trials = result.trials.map((trial) => rescored(evalCase, trial));
  return { ...result, bucket: evalCase.bucket, surface: evalCase.input.surface, trials };
}

/**
 * A report scored again against the cases as they are now, with no model call.
 *
 * @param report - The report.
 * @returns The report with its new statuses.
 */
export function rescore(report: Report): Report {
  return { ...report, results: report.results.map(rescoredCase) };
}

/**
 * An old report's outcome as one trial of its case, scored as the case is now.
 *
 * @param evidence - What the case made.
 * @returns The case's results; nothing when the case is gone.
 */
function upgraded(evidence: Evidence): CaseResult[] {
  const evalCase = caseOf(evidence.id);
  if (!evalCase) return [];
  const trace = { toolCalls: [], cache: { hits: 0, misses: 0 }, retries: 0 };
  // An old report kept the one truth it had, the orders of a report's run, in the outcome.
  const truth = isReport(evidence) ? { orders: evidence.truth ?? null } : {};
  const ran = { trial: 1, evidence, truth, trace };
  const trial = scoreTrial(evalCase, ran, unjudged(evalCase, 'the run had no judge'));
  return [
    { id: evalCase.id, bucket: evalCase.bucket, surface: evalCase.input.surface, trials: [trial] },
  ];
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
 * Reads a report, in today's format or the one before trials.
 *
 * @param path - Its file.
 * @returns The report.
 */
export function readReport(path: string): Report {
  const read = JSON.parse(readFileSync(path, 'utf8')) as Report | OldReport;
  if ('version' in read) return read;
  const { startedAt, models, cache, skipped } = read;
  return {
    version: 2,
    startedAt,
    models,
    versions: unrecorded,
    cache,
    judged: { hits: 0, misses: 0 },
    results: read.results.flatMap((result) => upgraded(result.outcome)),
    ...(skipped ? { skipped } : {}),
  };
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
 * The usage of a case's trials together.
 *
 * @param result - The case's results.
 * @returns The usage, by model.
 */
export function usageOf(result: CaseResult): TurnUsage {
  let total: TurnUsage = {};
  for (const trial of result.trials)
    for (const [model, tokens] of Object.entries(trial.evidence.usage))
      total = addUsage(total, model, tokens as TokenUsage);
  return total;
}

/**
 * The usage of every case together.
 *
 * @param results - The results.
 * @returns The usage, by model.
 */
export function totalUsage(results: readonly CaseResult[]): TurnUsage {
  let total: TurnUsage = {};
  for (const result of results)
    for (const [model, tokens] of Object.entries(usageOf(result)))
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
 * What a run case made, in two counts: answers and model steps.
 *
 * @param outcome - The run case's outcome.
 * @returns The two phrases.
 */
function answeredOf(outcome: RunAnswerCaseOutcome): readonly [string, string] {
  const steps = outcome.answers.reduce((sum, answer) => sum + answer.steps, 0);
  return [counted(outcome.answers.length, 'answer', 'answers'), counted(steps, 'step', 'steps')];
}

/**
 * What a trial made, in two counts: panels and repairs, reads and model steps, alert or report
 * versions and repairs, or answers and model steps.
 *
 * @param outcome - What the trial made.
 * @returns The two phrases.
 */
export function madeOf(outcome: Evidence): readonly [string, string] {
  if (isRunAnswer(outcome)) return answeredOf(outcome);
  if (isAlert(outcome) || isReport(outcome))
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
 * A case's status over its trials, in a word: `pass`, `FAIL`, `review` or `error`.
 *
 * @param status - The status.
 * @returns The word.
 */
export function statusWord(status: TrialStatus): string {
  return status === 'fail' ? 'FAIL' : status;
}

/**
 * A case's passes over its counted trials, such as `3/5`; empty for one trial.
 *
 * @param result - The case's results.
 * @returns The fraction.
 */
export function fractionWords(result: CaseResult): string {
  if (result.trials.length < 2) return '';
  const { pass, of } = fractionOf(result);
  return `${pass}/${of}${isUnstable(result) ? ', unstable' : ''}`;
}

/** How many cases of a bucket pass, of those that say something about the product. */
export interface Headline {
  /** The cases whose every counted trial passed. */
  readonly pass: number;
  /** The cases that ran without erring on every trial. */
  readonly of: number;
  /** The cases that wait for review. */
  readonly review: number;
  /** The cases that erred on every trial, which count in no fraction. */
  readonly errors: number;
  /** The cases whose trials disagree. */
  readonly unstable: number;
}

/**
 * The headline number of some cases.
 *
 * @param results - The results.
 * @param legacy - Whether to count as before rubrics and result checks.
 * @returns The passes, the cases counted, and those set apart.
 */
export function headlineOf(results: readonly CaseResult[], legacy = false): Headline {
  const statuses = results.map((result) => caseStatus(result, legacy));
  const count = (status: TrialStatus) => statuses.filter((each) => each === status).length;
  return {
    pass: count('pass'),
    of: results.length - count('error'),
    review: count('review'),
    errors: count('error'),
    unstable: results.filter(isUnstable).length,
  };
}

/**
 * The results of one bucket.
 *
 * @param results - The results.
 * @param bucket - The bucket.
 * @returns Its results.
 */
export function inBucket(results: readonly CaseResult[], bucket: Bucket): CaseResult[] {
  return results.filter((result) => result.bucket === bucket);
}

/**
 * How far the pass count of the same cases moves between two runs of the same code, for a reader
 * to tell a change from noise: two standard deviations of a count of cases that each pass with
 * the share seen.
 *
 * @param headline - The headline number.
 * @returns The cases, rounded up; 0 when every case agrees.
 */
export function noiseFloor({ pass, of }: Headline): number {
  if (of === 0) return 0;
  const share = pass / of;
  return Math.ceil(2 * Math.sqrt(of * share * (1 - share)));
}
