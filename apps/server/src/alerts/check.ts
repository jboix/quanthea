/**
 * Checks an alert spec before it is saved or activated: it validates, then runs the query once
 * over the window ending now and reads it as the evaluator would. The caller decides what to do
 * with the issues; the series found show what the alert would watch.
 */
import type { AlertSpec } from '@quanthea/shared';
import type { SpecIssue } from '../dashboards/issues.ts';
import { thresholdHolds } from './observe.ts';
import { type AlertQueryDependencies, runAlertQuery } from './run-query.ts';
import { reducePoints, seriesOf } from './series.ts';
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
 * Reads the series of a spec's result now.
 *
 * @param spec - The spec.
 * @param frames - The frames of its query.
 * @returns The series with their values, or the issues reading them.
 */
function readSeries(spec: AlertSpec, frames: Parameters<typeof seriesOf>[0]): AlertCheck {
  const extraction = seriesOf(frames, spec.value);
  if (extraction.problems.length > 0)
    return {
      ok: false,
      issues: extraction.problems.map((message) => ({ path: 'value', message })),
    };
  const { condition } = spec;
  const series = extraction.series.map((each) => {
    const value = reducePoints(each.points, spec.value.reduce);
    const holds = condition.kind === 'threshold' && thresholdHolds(condition, value);
    return { key: each.key, labels: each.labels, value, holds };
  });
  return { ok: true, spec, series, truncated: extraction.truncated };
}

/**
 * Checks an alert spec and runs its query once.
 *
 * @param dependencies - The connectors, the executor and the lookup of connectors.
 * @param input - The spec, as JSON.
 * @param now - The current instant.
 * @returns The valid spec with the series it sees now, or every issue.
 */
export async function checkAlert(
  dependencies: AlertQueryDependencies & Pick<AlertValidationContext, 'lookup'>,
  input: unknown,
  now: number,
): Promise<AlertCheck> {
  const validation = validateAlertSpec(input, { lookup: dependencies.lookup, now });
  if (!validation.ok) return validation;
  const { spec } = validation;
  const outcome = await runAlertQuery(dependencies, spec, windowAt(spec, now));
  if ('error' in outcome) return { ok: false, issues: [{ path: 'query', message: outcome.error }] };
  return readSeries(spec, outcome.frames);
}
