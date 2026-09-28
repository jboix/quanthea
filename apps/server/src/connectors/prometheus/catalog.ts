/** Reads the shape of a Prometheus server: metric names, their types, and their label keys. */
import type { SchemaEntity, SchemaSnapshot } from '../_shared/index.ts';
import type { PrometheusApi } from './api.ts';

/** The most metrics described; a larger server is described in part. */
const maxMetrics = 500;

/** How many API requests run at once while describing. */
const concurrency = 8;

/** Metadata Prometheus keeps about a metric family. */
interface MetricMetadata {
  /** `counter`, `gauge`, `histogram`, `summary` or `unknown`. */
  readonly type: string;
  /** The help text. */
  readonly help: string;
}

/**
 * Runs a task for every item, a few at a time.
 *
 * @param items - The inputs.
 * @param task - The work for one input.
 * @returns The results, in input order.
 */
async function mapConcurrently<In, Out>(
  items: readonly In[],
  task: (item: In) => Promise<Out>,
): Promise<Out[]> {
  const results: Out[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index] as In);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

/**
 * A selector that matches one metric name.
 *
 * @param metric - The metric name.
 * @returns Such as `{__name__="http_requests_total"}`.
 */
export function metricSelector(metric: string): string {
  return `{__name__="${metric.replace(/["\\]/g, '\\$&')}"}`;
}

/**
 * The description of a metric: its family's type and help text. Histograms and summaries are
 * described under the family name, without the `_bucket`, `_sum` or `_count` suffix.
 *
 * @param metric - The metric name.
 * @param metadata - The metadata of every family.
 * @returns Such as `counter: Requests served.`, or `undefined` without metadata.
 */
function describeMetric(
  metric: string,
  metadata: Readonly<Record<string, readonly MetricMetadata[]>>,
) {
  const family = metadata[metric] ?? metadata[metric.replace(/_(bucket|sum|count|total)$/, '')];
  const first = family?.[0];
  if (!first) return undefined;
  return first.help ? `${first.type}: ${first.help}` : first.type;
}

/** The labels of every metric, and how many values each label has across the server. */
interface LabelInfo {
  /** The label keys of each metric, in metric order. */
  readonly labelsByMetric: readonly (readonly string[])[];
  /** The number of distinct values of each label key. */
  readonly valueCounts: ReadonlyMap<string, number>;
}

/**
 * Reads the label keys of each metric, then counts the values of each key.
 *
 * @param api - The API client.
 * @param metrics - The metric names.
 * @param signal - The caller's signal.
 * @returns The labels and the value counts.
 */
async function readLabels(
  api: PrometheusApi,
  metrics: readonly string[],
  signal: AbortSignal,
): Promise<LabelInfo> {
  const labelsByMetric = await mapConcurrently(metrics, async (metric) => {
    const labels = await api.get<string[]>(
      '/api/v1/labels',
      { 'match[]': metricSelector(metric) },
      signal,
    );
    return labels.data.filter((label) => label !== '__name__');
  });
  const labelNames = [...new Set(labelsByMetric.flat())];
  const counts = await mapConcurrently(labelNames, async (label) => {
    const values = await api.get<string[]>(
      `/api/v1/label/${encodeURIComponent(label)}/values`,
      {},
      signal,
    );
    return [label, values.data.length] as const;
  });
  return { labelsByMetric, valueCounts: new Map(counts) };
}

/**
 * Reads the schema: every metric with its type and label keys, and how many values each label has.
 *
 * @param api - The API client.
 * @param signal - The caller's signal.
 * @returns The schema snapshot.
 */
export async function describePrometheus(
  api: PrometheusApi,
  signal: AbortSignal,
): Promise<SchemaSnapshot> {
  const [names, metadata] = await Promise.all([
    api.get<string[]>('/api/v1/label/__name__/values', {}, signal),
    api.get<Record<string, MetricMetadata[]>>('/api/v1/metadata', {}, signal),
  ]);
  const metrics = names.data.slice(0, maxMetrics);
  const { labelsByMetric, valueCounts } = await readLabels(api, metrics, signal);
  const entities = metrics.map((metric, index): SchemaEntity => {
    const description = describeMetric(metric, metadata.data);
    const fields = (labelsByMetric[index] ?? []).map((label) => ({
      name: label,
      nativeType: 'label',
      type: 'string' as const,
      distinctEstimate: valueCounts.get(label) ?? 0,
    }));
    return { name: metric, kind: 'metric', ...(description ? { description } : {}), fields };
  });
  return { entities };
}
