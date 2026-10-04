/**
 * What each feature spent: building dashboards, alerts and reports, questions about dashboards,
 * and panel explanations.
 */
import type { UsageBucket, UsageReport } from '@quanthea/shared';

/** A feature that runs model steps. */
export type UsageFeature = NonNullable<UsageBucket['feature']>;

/** The features, in the order the screen draws them, so each keeps its colour. */
export const usageFeatures: readonly UsageFeature[] = [
  'building',
  'alert',
  'report',
  'question',
  'explanation',
];

/** The plain name of each feature. */
export const featureNames: Readonly<Record<UsageFeature, string>> = {
  building: 'Building dashboards',
  alert: 'Building alerts',
  report: 'Building reports',
  question: 'Questions about dashboards',
  explanation: 'Panel explanations',
};

/** What one feature spent over the range. */
export interface FeatureUsage {
  /** The feature. */
  readonly feature: UsageFeature;
  /** Its plain name. */
  readonly name: string;
  /** Model steps. */
  readonly steps: number;
  /** Fresh input tokens, cache writes included. */
  readonly input: number;
  /** Input tokens read from the cache. */
  readonly cached: number;
  /** Output tokens. */
  readonly output: number;
  /** The list-price cost, for the priced steps. */
  readonly dollars: number;
  /** Whether some of its steps had no price. */
  readonly unpriced: boolean;
}

/**
 * A feature that spent nothing yet.
 *
 * @param feature - The feature.
 * @returns Its empty row.
 */
function emptyFeature(feature: UsageFeature): FeatureUsage {
  const name = featureNames[feature];
  return { feature, name, steps: 0, input: 0, cached: 0, output: 0, dollars: 0, unpriced: false };
}

/**
 * Adds a model step bucket to its feature's row.
 *
 * @param row - The feature's row so far.
 * @param bucket - A bucket of that feature.
 * @returns The row with the bucket.
 */
function withBucket(row: FeatureUsage, bucket: UsageBucket): FeatureUsage {
  return {
    ...row,
    steps: row.steps + bucket.events,
    input: row.input + bucket.input + bucket.cacheWrite,
    cached: row.cached + bucket.cachedInput,
    output: row.output + bucket.output,
    dollars: row.dollars + bucket.dollars,
    unpriced: row.unpriced || bucket.unpriced > 0,
  };
}

/**
 * The usage of each feature that ran a model step over the range, the costliest first, then the
 * one with the most steps.
 *
 * @param report - The report.
 * @returns One row per feature.
 */
export function usageByFeature(report: UsageReport): FeatureUsage[] {
  const rows = new Map<UsageFeature, FeatureUsage>();
  for (const bucket of report.buckets) {
    if (bucket.kind !== 'model' || bucket.feature === null) continue;
    const before = rows.get(bucket.feature) ?? emptyFeature(bucket.feature);
    rows.set(bucket.feature, withBucket(before, bucket));
  }
  return [...rows.values()].sort(
    (first, second) => second.dollars - first.dollars || second.steps - first.steps,
  );
}
