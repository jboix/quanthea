/**
 * What one evaluation observes of each series: the result of the query read against the spec's
 * condition. The alert as a whole is the series with the empty key: a failed query and the
 * `no_data` condition are observed there.
 */
import { type AlertSpec, type Frame, type Observation, thresholdHolds } from '@quanthea/shared';
import { type ObservedSeries, reducePoints, seriesOf } from './series.ts';

/** The key of the series that stands for the alert as a whole. */
export const wholeAlertKey = '';

/** What the query gave: frames, or why it failed. */
export type QueryOutcome = { readonly frames: readonly Frame[] } | { readonly error: string };

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
 * Observes a result against a threshold: each series by its value, known series left out as
 * missing, or every known series as `no_data` when the result is empty.
 *
 * @param spec - The spec, with a threshold condition.
 * @param series - The series of the result.
 * @param known - The keys of the series known before.
 * @returns The observations.
 */
function observeThreshold(
  spec: AlertSpec,
  series: readonly ObservedSeries[],
  known: ReadonlyMap<string, Readonly<Record<string, string>>>,
): Map<string, SeriesObservation> {
  const condition = spec.condition as Extract<AlertSpec['condition'], { kind: 'threshold' }>;
  const observed = new Map<string, SeriesObservation>();
  for (const each of series) {
    const value = reducePoints(each.points, spec.value.reduce);
    const holds = thresholdHolds(condition, value);
    observed.set(each.key, { labels: each.labels, observation: { kind: 'value', value, holds } });
  }
  const absent: Observation = series.length === 0 ? { kind: 'no_data' } : { kind: 'missing' };
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
 * @param known - The series known before; those of an earlier threshold version go missing.
 * @returns The observations.
 */
function observeNoData(
  series: readonly ObservedSeries[],
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
  const extraction = seriesOf(outcome.frames, spec.value);
  const [problem] = extraction.problems;
  if (problem !== undefined && extraction.series.length === 0)
    return { series: wholeAlert({ kind: 'error', message: problem }), truncated: false };
  const series =
    spec.condition.kind === 'no_data'
      ? observeNoData(extraction.series, known)
      : observeThreshold(spec, extraction.series, known);
  return { series, truncated: extraction.truncated };
}
