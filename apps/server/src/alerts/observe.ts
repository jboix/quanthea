/**
 * What one evaluation observes of each series: the result of the query read against the spec's
 * condition. The alert as a whole is the series with the empty key: a failed query and the
 * `no_data` condition are observed there.
 */
import type { AlertSpec, Frame, Observation } from '@quanthea/shared';
import { type Measured, measure, observeSeries, pastsOf } from './measure.ts';

/** The key of the series that stands for the alert as a whole. */
export const wholeAlertKey = '';

/**
 * What the query gave: frames, with those of the history query when the condition reads history,
 * or why either failed.
 */
export type QueryOutcome =
  | { readonly frames: readonly Frame[]; readonly history?: readonly Frame[] }
  | { readonly error: string };

/** An observation of one series, with its labels. */
export interface SeriesObservation {
  /** The series labels. */
  readonly labels: Readonly<Record<string, string>>;
  /** What was observed. */
  readonly observation: Observation;
}

/** The observations of one evaluation, by series key. */
export interface EvaluationObservations {
  /** The observation of each series. */
  readonly series: ReadonlyMap<string, SeriesObservation>;
  /** Whether series were dropped over the cap. */
  readonly truncated: boolean;
}

/**
 * Observes the series of a result against the condition's tests: each series by its readings,
 * known series left out as missing, or every known series as `no_data` when the result is empty.
 *
 * @param spec - The spec, with a condition that tests series.
 * @param measured - The series of the result.
 * @param known - The keys of the series known before.
 * @returns The observations.
 */
function observeTests(
  spec: AlertSpec,
  measured: Measured,
  known: ReadonlyMap<string, Readonly<Record<string, string>>>,
): Map<string, SeriesObservation> {
  const observed = new Map<string, SeriesObservation>();
  for (const each of measured.series) {
    const pasts = pastsOf(measured, each);
    const observation = observeSeries(spec, measured.measures, each.columns, pasts);
    observed.set(each.key, { labels: each.labels, observation });
  }
  const absent: Observation =
    measured.series.length === 0 ? { kind: 'no_data' } : { kind: 'missing' };
  for (const [key, labels] of known) {
    if (observed.has(key)) continue;
    const whole = key === wholeAlertKey;
    const observation: Observation = whole ? { kind: 'value', value: null, holds: false } : absent;
    observed.set(key, { labels, observation });
  }
  return observed;
}

/**
 * The observations of the alert as a whole only.
 *
 * @param observation - What was observed.
 * @returns One observation, under the whole alert's key.
 */
function wholeAlert(observation: Observation): Map<string, SeriesObservation> {
  return new Map([[wholeAlertKey, { labels: {}, observation }]]);
}

/**
 * Observes a result against the `no_data` condition: it holds when no series came back.
 *
 * @param series - The series of the result.
 * @param known - The series known before; those of an earlier version that tested series go
 *   missing.
 * @returns The observations.
 */
function observeNoData(
  series: readonly unknown[],
  known: ReadonlyMap<string, Readonly<Record<string, string>>>,
): Map<string, SeriesObservation> {
  const observed = wholeAlert({ kind: 'value', value: null, holds: series.length === 0 });
  for (const [key, labels] of known)
    if (key !== wholeAlertKey) observed.set(key, { labels, observation: { kind: 'missing' } });
  return observed;
}

/**
 * Observes a result.
 *
 * @param spec - The spec.
 * @param outcome - The frames of the query, or why it failed.
 * @param known - The labels of the series known before, by key.
 * @returns The observation of each series.
 */
export function observe(
  spec: AlertSpec,
  outcome: QueryOutcome,
  known: ReadonlyMap<string, Readonly<Record<string, string>>>,
): EvaluationObservations {
  if ('error' in outcome)
    return { series: wholeAlert({ kind: 'error', message: outcome.error }), truncated: false };
  const measured = measure(outcome.frames, spec, outcome.history);
  const { failure } = measured;
  if (failure !== undefined)
    return { series: wholeAlert({ kind: 'error', message: failure }), truncated: false };
  const series =
    spec.condition.kind === 'no_data'
      ? observeNoData(measured.series, known)
      : observeTests(spec, measured, known);
  return { series, truncated: measured.truncated };
}
