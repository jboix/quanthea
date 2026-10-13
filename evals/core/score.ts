/**
 * Turns checks and verdicts into a status. Checks run in order, and a failed gate skips what
 * comes after it, so one failure gives one reason. A legacy check stands in for a rubric or a
 * result check, and counts only while the trial has none.
 */
import type { Check, CheckContext } from './case.ts';
import type { CheckOutcome, TrialStatus, Verdict } from './result.ts';

/** What a legacy check stands in for. */
type StandIn = NonNullable<Check<unknown>['standsInFor']>;

/** A check's outcome, with what the check declared. */
export interface Checked extends CheckOutcome {
  /** What it stands in for, for a legacy check. */
  readonly standsInFor?: StandIn;
  /** Whether the scoring before rubrics and results did not have it. */
  readonly added: boolean;
}

/**
 * Whether the truths a check compares with were recorded. A report written before a truth existed
 * holds none, so a check that needs it has nothing to say there.
 *
 * @param check - The check.
 * @param context - The truths.
 * @returns Whether each of its truths has an entry, a value or the note that it could not be computed.
 */
function recorded<Evidence>(check: Check<Evidence>, context: CheckContext): boolean {
  return (check.truths ?? []).every((truth) => truth.key in context.truth);
}

/**
 * Runs one check, or skips it: after a gate failed, or when its truth was never recorded.
 *
 * @param check - The check.
 * @param evidence - What the case made.
 * @param context - The truths.
 * @param open - Whether no gate failed before it.
 * @returns The check's outcome.
 */
function runCheck<Evidence>(
  check: Check<Evidence>,
  evidence: Evidence,
  context: CheckContext,
  open: boolean,
): Checked {
  const { id, kind, standsInFor } = check;
  const base = { id, kind, added: check.added === true, ...(standsInFor ? { standsInFor } : {}) };
  if (!open || !recorded(check, context))
    return { ...base, outcome: 'skipped', message: '', faults: [] };
  const faults = check.faults(evidence, context);
  const outcome = faults.length === 0 ? 'pass' : 'fail';
  return { ...base, outcome, message: faults.join('; '), faults };
}

/**
 * Runs checks in order. After a gate fails, the checks after it are skipped, and so is a check
 * whose truth was never recorded.
 *
 * @param checks - The checks.
 * @param evidence - What the case made.
 * @param context - The truths.
 * @returns Each check's outcome.
 */
export function runChecks<Evidence>(
  checks: readonly Check<Evidence>[],
  evidence: Evidence,
  context: CheckContext,
): Checked[] {
  let open = true;
  return checks.map((check) => {
    const outcome = runCheck(check, evidence, context, open);
    if (outcome.outcome === 'fail' && check.gate) open = false;
    return outcome;
  });
}

/**
 * Whether the rubric was judged: a verdict came back for a sentence.
 *
 * @param verdicts - The verdicts.
 * @returns Whether a judge answered.
 */
function judged(verdicts: readonly Verdict[]): boolean {
  return verdicts.some((verdict) => verdict.verdict !== 'skipped');
}

/**
 * The checks that decide a trial: every check, without the legacy ones whose rubric was judged or
 * whose result check ran.
 *
 * @param checks - Each check's outcome.
 * @param verdicts - Each sentence's verdict.
 * @returns The checks that count.
 */
export function decidingChecks(
  checks: readonly Checked[],
  verdicts: readonly Verdict[],
): readonly Checked[] {
  const has: Record<StandIn, boolean> = {
    rubric: judged(verdicts),
    result: checks.some((check) => check.kind === 'result' && check.outcome !== 'skipped'),
  };
  return checks.filter((check) => !(check.standsInFor && has[check.standsInFor]));
}

/**
 * How a trial ended: an error when the run failed; a failure when a deciding check failed or the
 * judge said no; a review when nothing failed and the judge was unsure; else a pass.
 *
 * @param error - Why the run failed, if it did.
 * @param checks - Each check's outcome.
 * @param verdicts - Each sentence's verdict.
 * @returns The status.
 */
export function statusOf(
  error: string | undefined,
  checks: readonly Checked[],
  verdicts: readonly Verdict[],
): TrialStatus {
  if (error !== undefined) return 'error';
  const deciding = decidingChecks(checks, verdicts);
  if (deciding.some((check) => check.outcome === 'fail')) return 'fail';
  if (verdicts.some((verdict) => verdict.verdict === 'no')) return 'fail';
  return verdicts.some((verdict) => verdict.verdict === 'uncertain') ? 'review' : 'pass';
}

/**
 * How a trial would have ended before rubrics and result checks: every check the old scoring had
 * counts, and no verdict does.
 *
 * @param error - Why the run failed, if it did.
 * @param checks - Each check's outcome.
 * @returns The status.
 */
export function legacyStatusOf(error: string | undefined, checks: readonly Checked[]): TrialStatus {
  if (error !== undefined) return 'error';
  return checks.some((check) => !check.added && check.outcome === 'fail') ? 'fail' : 'pass';
}

/**
 * Whether the judge should read a trial's rubric: the run did not fail, and no check that would
 * still count with a judged rubric failed. A judge call on what already failed is money for
 * nothing.
 *
 * @param error - Why the run failed, if it did.
 * @param checks - Each check's outcome.
 * @returns Whether to judge.
 */
export function worthJudging(error: string | undefined, checks: readonly Checked[]): boolean {
  if (error !== undefined) return false;
  return !checks.some((check) => check.outcome === 'fail' && check.standsInFor !== 'rubric');
}
