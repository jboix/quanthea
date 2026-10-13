/**
 * Scores one trial of a case from what it made: runs the case's checks, takes the judge's
 * verdicts, and settles the status. Pure, so a saved report can be scored again with no model call.
 */
import { isAlert } from '../checks/alert.ts';
import { isAnswer } from '../checks/answer.ts';
import { isReport } from '../checks/report.ts';
import { isRunAnswer } from '../checks/run-answer.ts';
import { dashboardLayout, type LayoutMark, reportLayout } from '../report/layout-mark.ts';
import { checksOf } from '../surfaces/index.ts';
import type { EvalCase, Evidence } from './case.ts';
import type { CheckOutcome, Trace, TrialResult, Verdict } from './result.ts';
import { type Checked, legacyStatusOf, runChecks, statusOf } from './score.ts';

/** What a trial gave, before it is scored. */
export interface Ran {
  /** Its number, from 1. */
  readonly trial: number;
  /** What the case made. */
  readonly evidence: Evidence;
  /** The truths its checks compare with, by key. */
  readonly truth: Readonly<Record<string, unknown>>;
  /** What happened. */
  readonly trace: Trace;
}

/**
 * The patterns of a case's checks: what it asks for, as the layout mark reads it.
 *
 * @param evalCase - The case.
 * @returns The patterns.
 */
function patternsOf(evalCase: EvalCase): RegExp[] {
  return evalCase.checks.flatMap((check) => (check.pattern ? [check.pattern] : []));
}

/**
 * Marks the layout of the dashboard or the report a trial saved. The mark stands beside the
 * status and never changes it.
 *
 * @param evalCase - The case.
 * @param evidence - What it made.
 * @returns The field to spread; none for what has no layout, such as an answer.
 */
function layoutField(evalCase: EvalCase, evidence: Evidence): { layout?: LayoutMark } {
  if (isRunAnswer(evidence) || isAlert(evidence) || isAnswer(evidence)) return {};
  const layout = isReport(evidence)
    ? reportLayout(evidence, patternsOf(evalCase))
    : dashboardLayout(evidence, patternsOf(evalCase));
  return layout ? { layout } : {};
}

/**
 * A check's outcome as a result keeps it.
 *
 * @param checked - The outcome, with what the check declared.
 * @returns The outcome.
 */
function kept({ id, kind, outcome, message, faults }: Checked): CheckOutcome {
  return { id, kind, outcome, message, faults };
}

/**
 * The checks of a trial, run.
 *
 * @param evalCase - The case.
 * @param ran - What the trial gave.
 * @returns Each check's outcome, with what the check declared.
 */
export function checked(evalCase: EvalCase, ran: Pick<Ran, 'evidence' | 'truth'>): Checked[] {
  return runChecks(checksOf(evalCase), ran.evidence, { truth: ran.truth });
}

/**
 * The verdicts of a rubric nobody judged.
 *
 * @param evalCase - The case.
 * @param reason - Why no judge read it.
 * @returns One skipped verdict per sentence.
 */
export function unjudged(evalCase: EvalCase, reason: string): Verdict[] {
  return (evalCase.rubric ?? []).map((sentence) => ({
    sentence,
    verdict: 'skipped',
    reason,
    evidence: '',
  }));
}

/**
 * Scores a trial.
 *
 * @param evalCase - The case.
 * @param ran - What the trial gave.
 * @param verdicts - The judge's verdicts; skipped ones when no judge read the rubric.
 * @returns The trial's result.
 */
export function scoreTrial(
  evalCase: EvalCase,
  ran: Ran,
  verdicts: readonly Verdict[],
): TrialResult {
  const checks = checked(evalCase, ran);
  const { error } = ran.evidence;
  return {
    trial: ran.trial,
    status: statusOf(error, checks, verdicts),
    legacyStatus: legacyStatusOf(error, checks),
    checks: checks.map(kept),
    verdicts,
    evidence: ran.evidence,
    truth: ran.truth,
    trace: ran.trace,
    ...layoutField(evalCase, ran.evidence),
  };
}
