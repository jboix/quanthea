/**
 * The usage report in the shapes the screen shows: days in the browser's time zone, totals, and
 * one row per model. The server sends hours, so a day here is the viewer's own day.
 */
import type { UsageBucket, UsageReport } from '@quanthea/shared';

/** One day of usage. */
export interface DayUsage {
  /** The day's local midnight, epoch milliseconds. */
  readonly day: number;
  /** Fresh input tokens, cache writes included. */
  readonly input: number;
  /** Input tokens read from the cache. */
  readonly cached: number;
  /** Output tokens. */
  readonly output: number;
  /** The list-price cost, for the priced steps. */
  readonly dollars: number;
  /** Model steps. */
  readonly steps: number;
  /** Views of pinned dashboards and of snapshots. */
  readonly views: number;
  /** The tokens and cost of each model that ran that day, by model id. */
  readonly byModel: Readonly<Record<string, ModelDay>>;
}

/** What one model spent on one day. */
export interface ModelDay {
  /** All its tokens: input, cache reads and writes, and output. */
  readonly tokens: number;
  /** Its list-price cost, in US dollars. */
  readonly dollars: number;
}

/** One model's usage over the range. */
export interface ModelUsage {
  /** The provider. */
  readonly provider: string;
  /** The model id. */
  readonly model: string;
  /** Model steps. */
  readonly steps: number;
  /** Fresh input tokens, cache writes included. */
  readonly input: number;
  /** Input tokens read from the cache. */
  readonly cached: number;
  /** Output tokens. */
  readonly output: number;
  /** The list-price cost. */
  readonly dollars: number;
  /** Whether some of its steps had no price. */
  readonly unpriced: boolean;
}

/** A day with nothing in it. */
const emptyDay = { input: 0, cached: 0, output: 0, dollars: 0, steps: 0, views: 0, byModel: {} };

/**
 * The local midnight of an instant.
 *
 * @param at - Epoch milliseconds.
 * @returns The midnight before it, in the browser's zone.
 */
export function localDay(at: number): number {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Adds a bucket to what its model spent that day.
 *
 * @param byModel - What each model spent that day so far.
 * @param bucket - A model step bucket.
 * @returns What each model spent, with the bucket.
 */
function withModel(
  byModel: Readonly<Record<string, ModelDay>>,
  bucket: UsageBucket,
): Readonly<Record<string, ModelDay>> {
  const before = byModel[bucket.model] ?? { tokens: 0, dollars: 0 };
  const tokens = bucket.input + bucket.cachedInput + bucket.cacheWrite + bucket.output;
  const after = { tokens: before.tokens + tokens, dollars: before.dollars + bucket.dollars };
  return { ...byModel, [bucket.model]: after };
}

/**
 * Adds an hour's bucket to its day.
 *
 * @param day - The day so far.
 * @param bucket - The bucket.
 * @returns The day with the bucket.
 */
function withBucket(day: DayUsage, bucket: UsageBucket): DayUsage {
  if (bucket.kind !== 'model') return { ...day, views: day.views + bucket.events };
  return {
    ...day,
    byModel: withModel(day.byModel, bucket),
    input: day.input + bucket.input + bucket.cacheWrite,
    cached: day.cached + bucket.cachedInput,
    output: day.output + bucket.output,
    dollars: day.dollars + bucket.dollars,
    steps: day.steps + bucket.events,
  };
}

/**
 * Every day of the report's range, empty days included, oldest first.
 *
 * @param report - The report.
 * @returns The days.
 */
export function dailyUsage(report: UsageReport): DayUsage[] {
  const days = new Map<number, DayUsage>();
  for (let day = localDay(report.from); day <= report.to; day = localDay(day + 36 * 3_600_000)) {
    days.set(day, { day, ...emptyDay });
  }
  for (const bucket of report.buckets) {
    const key = localDay(bucket.hour);
    days.set(key, withBucket(days.get(key) ?? { day: key, ...emptyDay }, bucket));
  }
  return [...days.values()].sort((first, second) => first.day - second.day);
}

/**
 * The totals of some days.
 *
 * @param days - The days.
 * @returns Their sums.
 */
export function totalUsage(days: readonly DayUsage[]): Omit<DayUsage, 'day' | 'byModel'> {
  return days.reduce<Omit<DayUsage, 'day' | 'byModel'>>(
    (sum, day) => ({
      input: sum.input + day.input,
      cached: sum.cached + day.cached,
      output: sum.output + day.output,
      dollars: sum.dollars + day.dollars,
      steps: sum.steps + day.steps,
      views: sum.views + day.views,
    }),
    { input: 0, cached: 0, output: 0, dollars: 0, steps: 0, views: 0 },
  );
}

/**
 * The models to draw one by one, the costliest first; the rest add up to `Other`.
 *
 * @param models - The usage of each model, the costliest first.
 * @param limit - How many models to draw one by one.
 * @returns The model ids, and whether an `Other` series gathers the rest.
 */
export function chartedModels(
  models: readonly ModelUsage[],
  limit = 5,
): { readonly shown: readonly string[]; readonly other: boolean } {
  return { shown: models.slice(0, limit).map((each) => each.model), other: models.length > limit };
}

/**
 * The usage of each model over the range, the costliest first.
 *
 * @param report - The report.
 * @returns One row per provider and model.
 */
export function usageByModel(report: UsageReport): ModelUsage[] {
  const models = new Map<string, ModelUsage>();
  for (const bucket of report.buckets) {
    if (bucket.kind !== 'model') continue;
    const key = `${bucket.provider}\u0000${bucket.model}`;
    const before = models.get(key) ?? {
      provider: bucket.provider,
      model: bucket.model,
      steps: 0,
      input: 0,
      cached: 0,
      output: 0,
      dollars: 0,
      unpriced: false,
    };
    models.set(key, {
      ...before,
      steps: before.steps + bucket.events,
      input: before.input + bucket.input + bucket.cacheWrite,
      cached: before.cached + bucket.cachedInput,
      output: before.output + bucket.output,
      dollars: before.dollars + bucket.dollars,
      unpriced: before.unpriced || bucket.unpriced > 0,
    });
  }
  return [...models.values()].sort(
    (first, second) => second.dollars - first.dollars || second.steps - first.steps,
  );
}
