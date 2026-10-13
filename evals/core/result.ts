/**
 * What a trial of a case gave: each check's outcome, each rubric sentence's verdict, a status, and
 * the trace to read when it fails. A case has one result per trial.
 */
import type { LayoutMark } from '../report/layout-mark.ts';
import type { Bucket, CheckKind, Evidence, SurfaceName } from './case.ts';

/** How a check came out. Skipped: a check it needs failed before it. */
export type CheckStatus = 'pass' | 'fail' | 'skipped';

/** One check's outcome. */
export interface CheckOutcome {
  /** The check's name. */
  readonly id: string;
  /** How it decides. */
  readonly kind: CheckKind;
  /** How it came out. */
  readonly outcome: CheckStatus;
  /** Its faults joined, when it failed. */
  readonly message: string;
  /** Its faults, one sentence each. */
  readonly faults: readonly string[];
}

/** The judge's answer to a sentence. Skipped: a check failed, or no judge ran. */
export type VerdictValue = 'yes' | 'no' | 'uncertain' | 'skipped';

/** One rubric sentence's verdict. */
export interface Verdict {
  /** The sentence. */
  readonly sentence: string;
  /** The judge's answer. */
  readonly verdict: VerdictValue;
  /** Why, in one sentence. */
  readonly reason: string;
  /** The piece of what it read that it bases the answer on. */
  readonly evidence: string;
}

/**
 * How a trial ended. Error: the provider or the harness failed, so it says nothing about the
 * product and counts in no fraction. Review: nothing failed, and the judge was not sure.
 */
export type TrialStatus = 'pass' | 'fail' | 'review' | 'error';

/** One tool call of a trial. */
export interface TracedCall {
  /** The tool's name. */
  readonly tool: string;
  /** What the model sent, as JSON, cut short. */
  readonly input: string;
  /** What it got back, as JSON, cut short; empty when the call never ended. */
  readonly output: string;
}

/** What happened in a trial, to read when it fails. */
export interface Trace {
  /** The model's tool calls, in order. */
  readonly toolCalls: readonly TracedCall[];
  /** The model answers that came from the cache, and from the provider. */
  readonly cache: { readonly hits: number; readonly misses: number };
  /** How many times the trial was run again after an error. */
  readonly retries: number;
}

/** What acting on a surface gave. */
export interface Acted<Made> {
  /** What the case made. */
  readonly evidence: Made;
  /** The model's tool calls, in order. */
  readonly toolCalls: readonly TracedCall[];
}

/** One trial of a case. */
export interface TrialResult {
  /** Its number, from 1. */
  readonly trial: number;
  /** How it ended. */
  readonly status: TrialStatus;
  /** How it would have ended before rubrics and result checks: every check counted, no judge. */
  readonly legacyStatus: TrialStatus;
  /** Each check's outcome, in order. */
  readonly checks: readonly CheckOutcome[];
  /** Each rubric sentence's verdict, in order. */
  readonly verdicts: readonly Verdict[];
  /** What the case made. */
  readonly evidence: Evidence;
  /** The truths its checks compared with, by key. */
  readonly truth: Readonly<Record<string, unknown>>;
  /** What happened. */
  readonly trace: Trace;
  /** How the layout of what it saved reads; absent when it saved no dashboard and no report. */
  readonly layout?: LayoutMark;
}

/** A case's results: one per trial. */
export interface CaseResult {
  /** The case's id. */
  readonly id: string;
  /** Why the case exists. */
  readonly bucket: Bucket;
  /** The surface it acts on. */
  readonly surface: SurfaceName;
  /** Its trials, in order. */
  readonly trials: readonly TrialResult[];
}

/** What produced a run's numbers: a change in any of them can change the numbers. */
export interface RunVersions {
  /** The judge's model, or `null` when no judge ran. */
  readonly judge: string | null;
  /** The version of the judge's instructions. */
  readonly judgePrompt: number;
  /** The day of the dev data: its incident is the day before. */
  readonly data: string;
  /** The name of the sample set the model answers were drawn for. */
  readonly sample: string;
}

/**
 * The trials that say something about the product: those that did not end in an error.
 *
 * @param result - A case's results.
 * @returns The trials.
 */
export function countedTrials(result: CaseResult): TrialResult[] {
  return result.trials.filter((trial) => trial.status !== 'error');
}

/**
 * A case's passes over its counted trials.
 *
 * @param result - A case's results.
 * @param legacy - Whether to count as before rubrics and result checks.
 * @returns The passes and the trials counted.
 */
export function fractionOf(result: CaseResult, legacy = false): { pass: number; of: number } {
  const counted = result.trials.filter(
    (trial) => (legacy ? trial.legacyStatus : trial.status) !== 'error',
  );
  const pass = counted.filter(
    (trial) => (legacy ? trial.legacyStatus : trial.status) === 'pass',
  ).length;
  return { pass, of: counted.length };
}

/**
 * How a case ended over its trials: an error when every trial erred, a pass when every counted
 * trial passed, a review when none failed and one waits for review, else a failure.
 *
 * @param result - A case's results.
 * @param legacy - Whether to count as before rubrics and result checks.
 * @returns The status.
 */
export function caseStatus(result: CaseResult, legacy = false): TrialStatus {
  const statuses = result.trials
    .map((trial) => (legacy ? trial.legacyStatus : trial.status))
    .filter((status) => status !== 'error');
  if (statuses.length === 0) return 'error';
  if (statuses.every((status) => status === 'pass')) return 'pass';
  return statuses.includes('fail') ? 'fail' : 'review';
}

/**
 * Whether a case's trials disagree: some pass and some fail. One trial never disagrees.
 *
 * @param result - A case's results.
 * @returns Whether it is unstable in this run.
 */
export function isUnstable(result: CaseResult): boolean {
  const { pass, of } = fractionOf(result);
  return pass > 0 && pass < of;
}

/**
 * Why a trial did not pass: each failed check's faults, then each sentence the judge refused or
 * was unsure of.
 *
 * @param trial - The trial.
 * @returns The reasons; none for a pass.
 */
export function reasonsOf(trial: TrialResult): string[] {
  const failed = trial.checks.filter((check) => check.outcome === 'fail');
  const refused = trial.verdicts
    .filter((verdict) => verdict.verdict === 'no' || verdict.verdict === 'uncertain')
    .map(
      (verdict) =>
        `${verdict.verdict === 'no' ? 'not' : 'unsure whether'}: ${verdict.sentence} (${verdict.reason})`,
    );
  return [...failed.flatMap((check) => check.faults), ...refused];
}
