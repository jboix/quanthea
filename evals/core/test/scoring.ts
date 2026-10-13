/** Helpers shared by the tests of the checks: run a list of checks and read what did not hold. */
import { allCases } from '../../cases/index.ts';
import type { Report } from '../../report/report.ts';
import { checksOf } from '../../surfaces/index.ts';
import type { Check, Evidence } from '../case.ts';
import type { TrialStatus } from '../result.ts';
import { runChecks, statusOf } from '../score.ts';
import type { Skipped } from '../select.ts';
import { scoreTrial, unjudged } from '../trial.ts';

/** What a list of checks says of some evidence. */
export interface Scored {
  /** Whether the trial passes. */
  readonly pass: boolean;
  /** How the trial ends. */
  readonly status: TrialStatus;
  /** The faults of the checks that failed, in the checks' order. */
  readonly reasons: readonly string[];
}

/**
 * Runs checks on evidence, with no judge.
 *
 * @param checks - The checks, in order.
 * @param evidence - What a case made.
 * @param truth - The truths the checks compare with, by key.
 * @returns The status and the faults.
 */
export function scored<Evidence extends { readonly error?: string }>(
  checks: readonly Check<Evidence>[],
  evidence: Evidence,
  truth: Readonly<Record<string, unknown>> = {},
): Scored {
  const outcomes = runChecks(checks, evidence, { truth });
  const status = statusOf(evidence.error, outcomes, []);
  const reasons = outcomes
    .filter((outcome) => outcome.outcome === 'fail')
    .flatMap((outcome) => outcome.faults);
  return { pass: status === 'pass', status, reasons };
}

/**
 * Scores evidence against a case as it is, with its surface's own checks, and no judge.
 *
 * @param id - The case's id.
 * @param evidence - What the case made.
 * @param truth - The truths its checks compare with, by key.
 * @returns Whether it passes, and what does not hold.
 * @throws {Error} When no case has the id.
 */
export function scoredCase(
  id: string,
  evidence: Evidence,
  truth: Readonly<Record<string, unknown>> = {},
): { pass: boolean; reasons: readonly string[] } {
  const evalCase = allCases.find((each) => each.id === id);
  if (!evalCase) throw new Error(`No case ${id}.`);
  const { pass, reasons } = scored(checksOf(evalCase), evidence, truth);
  return { pass, reasons };
}

/**
 * A report of one trial per case, scored against the cases as they are, with no judge.
 *
 * @param evidence - What each case made; each names its case by its id.
 * @param skipped - The cases that were not run.
 * @returns The report.
 */
export function reportOf(evidence: readonly Evidence[], skipped: readonly Skipped[] = []): Report {
  const results = evidence.flatMap((made) => {
    const evalCase = allCases.find((each) => each.id === made.id);
    if (!evalCase) return [];
    const trace = { toolCalls: [], cache: { hits: 0, misses: 0 }, retries: 0 };
    const ran = { trial: 1, evidence: made, truth: {}, trace };
    const trial = scoreTrial(evalCase, ran, unjudged(evalCase, 'the run had no judge'));
    const { id, bucket, input } = evalCase;
    return [{ id, bucket, surface: input.surface, trials: [trial] }];
  });
  return {
    version: 2,
    startedAt: '2026-10-03T10:00:00.000Z',
    models: { model: 'test-model' },
    versions: { judge: null, judgePrompt: 0, data: '2026-10-03', sample: '' },
    cache: { hits: 1, misses: 0 },
    judged: { hits: 0, misses: 0 },
    results,
    ...(skipped.length > 0 ? { skipped } : {}),
  };
}
