/**
 * Checks an alert spec before it is saved or activated: it validates, then runs the query once
 * over the window ending now, with the second query of a ratio and the history query of a
 * condition that reads history, and reads them as the evaluator would. The caller decides what to
 * do with the issues; the series found show what the alert would watch.
 */
import {
  type AlertSpec,
  agoText,
  type ConditionTest,
  conditionTests,
  testPath,
} from '@quanthea/shared';
import { pathOf, type SpecIssue } from '../dashboards/issues.ts';
import { minBaselinePoints } from './baseline.ts';
import { type Measured, measure, pastsOf, readSeries, type SeriesReading } from './measure.ts';
import { type AlertQueryDependencies, runEvaluationQueries } from './run-query.ts';
import { type AlertValidationContext, validateAlertSpec } from './validate.ts';

/** A series as one evaluation now would see it. */
export interface CheckedSeries {
  /** The series key. */
  readonly key: string;
  /** The labels. */
  readonly labels: Readonly<Record<string, string>>;
  /** Its value now. */
  readonly value: number | null;
  /** Whether the condition holds for it now. */
  readonly holds: boolean;
}

/** The outcome of a check. */
export type AlertCheck =
  | { readonly ok: false; readonly issues: readonly SpecIssue[] }
  | {
      readonly ok: true;
      readonly spec: AlertSpec;
      readonly series: readonly CheckedSeries[];
      readonly truncated: boolean;
    };

/**
 * Why a test that compares with an earlier value could never hold on a result where no series has
 * one, and the field of the test that says how far back it looks.
 *
 * @param test - The test.
 * @returns The field and the reason, or `undefined` for a test that needs no earlier value.
 */
function historyNeed(test: ConditionTest): { name: string; message: string } | undefined {
  if (test.kind === 'change')
    return {
      name: 'within',
      message: `No series has a point ${test.within} before its latest one in the window. A change needs the points of the window, with their times: a query grouped by time, never an instant one, and a lookback longer than within.`,
    };
  if (test.kind === 'past')
    return {
      name: 'ago',
      message: `No series has a value ${agoText(test.ago)}: the query returns nothing for the same window then. The data must go back that far, and the query must read the time range it is given.`,
    };
  if (test.kind === 'band')
    return {
      name: 'baseline',
      message: `No series has enough history over the ${test.baseline} before the window to learn a band from: at least ${minBaselinePoints} points with their times, spanning half of it or more. A band needs a query grouped by time, never an instant one, and data that goes back that far.`,
    };
  return undefined;
}

/**
 * What keeps a test from ever holding: a result where no series has the earlier value the test
 * compares with. An instant query has no earlier point for a change, data that does not go back a
 * week has no value a week earlier, and a result of a few points gives no band.
 *
 * @param spec - The spec.
 * @param read - What each series of its result reads now.
 * @returns An issue per such test, at the field that says how far back it looks.
 */
function historyIssues(spec: AlertSpec, read: readonly (SeriesReading | null)[]): SpecIssue[] {
  if (read.length === 0) return [];
  return conditionTests(spec.condition).flatMap((test, index) => {
    const need = historyNeed(test);
    const found = read.some((each) => typeof each?.readings[index]?.reference === 'number');
    if (!need || found) return [];
    return [{ path: pathOf(testPath(spec.condition, index, need.name)), message: need.message }];
  });
}

/**
 * What keeps a ratio from ever having a value: a second query none of whose series matches a
 * series of the first, by the labels both carry.
 *
 * @param spec - The spec.
 * @param read - What each series of its result reads now.
 * @returns The issue, at `dividedBy`, or none for a spec without a ratio or without series.
 */
function ratioIssues(spec: AlertSpec, read: readonly (SeriesReading | null)[]): SpecIssue[] {
  if (!spec.dividedBy || read.length === 0) return [];
  const matched = read.some((each) => typeof each?.readings[0]?.denominator === 'number');
  if (matched) return [];
  const message =
    'No series of the query has one series of the second query to be divided by. Two series match when every label both carry has the same value, and a series of the first query needs exactly one match: return the same labels from both queries, or fewer from the second.';
  return [{ path: 'dividedBy', message }];
}

/**
 * Reads the series of a spec's result now.
 *
 * @param spec - The spec.
 * @param measured - The series of its queries.
 * @returns The series with their values, or the issues reading them.
 */
function readResult(spec: AlertSpec, measured: Measured): AlertCheck {
  const read = measured.series.map((each) =>
    readSeries(spec, measured.measures, each.columns, pastsOf(measured, each), each.divisor),
  );
  const issues = [
    ...measured.problems.map((message) => ({ path: 'value', message })),
    ...measured.divisorProblems.map((message) => ({ path: 'dividedBy', message })),
    ...historyIssues(spec, read),
    ...ratioIssues(spec, read),
  ];
  if (issues.length > 0) return { ok: false, issues };
  const series = measured.series.map((each, index) => ({
    key: each.key,
    labels: each.labels,
    value: read[index]?.value ?? null,
    holds: read[index]?.holds ?? false,
  }));
  return { ok: true, spec, series, truncated: measured.truncated };
}

/**
 * Checks an alert spec and runs its query once.
 *
 * @param dependencies - The connectors, the executor, the lookup of connectors and of channels.
 * @param input - The spec, as JSON.
 * @param now - The current instant.
 * @returns The valid spec with the series it sees now, or every issue.
 */
export async function checkAlert(
  dependencies: AlertQueryDependencies & Pick<AlertValidationContext, 'lookup' | 'channelExists'>,
  input: unknown,
  now: number,
): Promise<AlertCheck> {
  const { lookup, channelExists } = dependencies;
  const validation = validateAlertSpec(input, { lookup, channelExists, now });
  if (!validation.ok) return validation;
  const { spec } = validation;
  const outcome = await runEvaluationQueries(dependencies, spec, now);
  if ('error' in outcome) return { ok: false, issues: [{ path: 'query', message: outcome.error }] };
  return readResult(spec, measure(outcome.frames, spec, outcome.history, outcome.divisor));
}
