/**
 * Turns labelled series, in the result format of the Prometheus HTTP API, into frames. Prometheus
 * answers in it, and so do Loki's metric queries.
 */

import { createFrameBuilder } from './frame-builder.ts';
import type { Field, Frame } from './frames.ts';
import type { ExecutionContext } from './queries.ts';

/** One series of a range query. */
interface MatrixSeries {
  /** The series labels, including `__name__` when the query keeps it. */
  readonly metric: Readonly<Record<string, string>>;
  /** The points: Unix seconds and the value as a string. */
  readonly values: readonly (readonly [number, string])[];
}

/** One sample of an instant query. */
interface VectorSample {
  /** The series labels. */
  readonly metric: Readonly<Record<string, string>>;
  /** The point: Unix seconds and the value as a string. */
  readonly value: readonly [number, string];
}

/** The `data` of a query response: series over time, samples at one time, or one value. */
export type SeriesData =
  | { readonly resultType: 'matrix'; readonly result: readonly MatrixSeries[] }
  | { readonly resultType: 'vector'; readonly result: readonly VectorSample[] }
  | { readonly resultType: 'scalar' | 'string'; readonly result: readonly [number, string] };

/** The most series one query returns; more are dropped and the last frame marked truncated. */
const maxSeries = 1000;

/**
 * Converts a sample value.
 *
 * @param value - The value as the API writes it, such as `"0.084"`, `"NaN"` or `"+Inf"`.
 * @returns The number, or `null` when it is not finite.
 */
export function sampleValue(value: string): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * The display name of a series: its metric name and labels.
 *
 * @param metric - The series labels.
 * @returns Such as `http_requests_total{service="checkout-svc"}`, or `{}` for no labels.
 */
export function seriesName(metric: Readonly<Record<string, string>>): string {
  const { __name__: name = '', ...labels } = metric;
  const pairs = Object.entries(labels).map(([key, value]) => `${key}="${value}"`);
  return `${name}{${pairs.join(', ')}}`;
}

/**
 * Turns the series of a range query into one frame per series: time and value, the labels on the
 * value field.
 *
 * @param result - The series.
 * @param context - The execution context.
 * @param durationMs - How long the query took.
 * @returns The frames.
 */
function matrixFrames(
  result: readonly MatrixSeries[],
  context: ExecutionContext,
  durationMs: number,
): Frame[] {
  const frames = result.slice(0, maxSeries).map((series) => {
    const { __name__: _name, ...labels } = series.metric;
    const fields: Field[] = [
      { name: 'time', type: 'time' },
      { name: 'Value', type: 'number', labels },
    ];
    const builder = createFrameBuilder({
      refId: context.refId,
      fields,
      maxRows: context.maxRows,
      name: seriesName(series.metric),
    });
    for (const [seconds, value] of series.values) {
      if (!builder.add([seconds * 1000, sampleValue(value)])) break;
    }
    return builder.build(durationMs);
  });
  return markDroppedSeries(frames, result.length);
}

/**
 * Marks the last frame truncated when series were dropped.
 *
 * @param frames - The frames kept.
 * @param seriesCount - How many series the query returned.
 * @returns The frames.
 */
function markDroppedSeries(frames: Frame[], seriesCount: number): Frame[] {
  const last = frames.at(-1);
  if (seriesCount <= frames.length || !last) return frames;
  return [...frames.slice(0, -1), { ...last, meta: { ...last.meta, truncated: true } }];
}

/**
 * Turns the samples of an instant query into one table: a column per label, then the value.
 *
 * @param result - The samples.
 * @param context - The execution context.
 * @param durationMs - How long the query took.
 * @returns One frame.
 */
function vectorFrame(
  result: readonly VectorSample[],
  context: ExecutionContext,
  durationMs: number,
): Frame {
  const labelNames = [...new Set(result.flatMap((sample) => Object.keys(sample.metric)))]
    .filter((name) => name !== '__name__')
    .sort();
  const fields: Field[] = [
    ...labelNames.map((name) => ({ name, type: 'string' as const })),
    { name: 'Value', type: 'number' },
  ];
  const builder = createFrameBuilder({ refId: context.refId, fields, maxRows: context.maxRows });
  for (const sample of result) {
    const row = [
      ...labelNames.map((name) => sample.metric[name] ?? null),
      sampleValue(sample.value[1]),
    ];
    if (!builder.add(row)) break;
  }
  return builder.build(durationMs);
}

/**
 * Turns a series result into frames: one per series over time, one table of samples at one time.
 *
 * @param data - The `data` of the response.
 * @param context - The execution context.
 * @param durationMs - How long the query took.
 * @returns The frames.
 */
export function seriesFrames(
  data: SeriesData,
  context: ExecutionContext,
  durationMs: number,
): Frame[] {
  if (data.resultType === 'matrix') return matrixFrames(data.result, context, durationMs);
  if (data.resultType === 'vector') return [vectorFrame(data.result, context, durationMs)];
  const [seconds, value] = data.result;
  const valueType = data.resultType === 'scalar' ? 'number' : 'string';
  const builder = createFrameBuilder({
    refId: context.refId,
    fields: [
      { name: 'time', type: 'time' },
      { name: 'Value', type: valueType },
    ],
    maxRows: context.maxRows,
  });
  builder.add([seconds * 1000, valueType === 'number' ? sampleValue(value) : value]);
  return [builder.build(durationMs)];
}
