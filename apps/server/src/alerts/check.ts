/**
 * Checks an alert spec before it is saved or activated: it validates, then runs the query once
 * over the window ending now and reads it as the evaluator would. The caller decides what to do
 * with the issues; the series found show what the alert would watch.
 */
import { type AlertSpec, conditionTests, type Frame } from '@quanthea/shared';
import type { SpecIssue } from '../dashboards/issues.ts';
import { type Measured, measure, readSeries } from './measure.ts';
import { type AlertQueryDependencies, runAlertQuery } from './run-query.ts';
import { type AlertValidationContext, validateAlertSpec, windowAt } from './validate.ts';

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
 * What keeps a change from ever holding: a result whose series have no point as far back as the
 * change looks, such as an instant query or a result without a time column.
 *
 * @param spec - The spec.
 * @param measured - The series of its result.
 * @returns An issue per change test no series has an earlier point for.
 */
function historyIssues(spec: AlertSpec, measured: Measured): SpecIssue[] {
  if (measured.series.length === 0) return [];
  const joined = spec.condition.kind === 'all' || spec.condition.kind === 'any';
  return conditionTests(spec.condition).flatMap((test, index) => {
    if (test.kind !== 'change') return [];
    const read = measured.series.map((each) => readSeries(spec, measured.measures, each.columns));
    const found = read.some((each) => typeof each?.readings[index]?.reference === 'number');
    if (found) return [];
    const path = joined ? `condition.of[${index}].within` : 'condition.within';
    const message = `No series has a point ${test.within} before its latest one in the window. A change needs the points of the window, with their times: a query grouped by time, never an instant one, and a lookback longer than within.`;
    return [{ path, message }];
  });
}

/**
 * Reads the series of a spec's result now.
 *
 * @param spec - The spec.
 * @param frames - The frames of its query.
 * @returns The series with their values, or the issues reading them.
 */
function readResult(spec: AlertSpec, frames: readonly Frame[]): AlertCheck {
  const measured = measure(frames, spec);
  const issues = [
    ...measured.problems.map((message) => ({ path: 'value', message })),
    ...historyIssues(spec, measured),
  ];
  if (issues.length > 0) return { ok: false, issues };
  const series = measured.series.map((each) => {
    const read = readSeries(spec, measured.measures, each.columns);
    return {
      key: each.key,
      labels: each.labels,
      value: read?.value ?? null,
      holds: read?.holds ?? false,
    };
  });
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
  const outcome = await runAlertQuery(dependencies, spec, windowAt(spec, now));
  if ('error' in outcome) return { ok: false, issues: [{ path: 'query', message: outcome.error }] };
  return readResult(spec, outcome.frames);
}
