/** Helpers shared by the alert tests: specs, frames and a query engine that returns fixed frames. */
import { type AlertSpec, alertSpecSchema, type Field, type Frame } from '@quanthea/shared';
import type { QueryExecutor, QueryRequest, QuerySource } from '../../query/executor.ts';
import { QueryError } from '../../query/query-error.ts';

/** A minute, in milliseconds. */
export const minute = 60_000;

/**
 * A valid spec: the 5xx share of each service above 5% for 5 minutes, every minute.
 *
 * @param overrides - Fields to replace.
 * @returns The spec, as JSON.
 */
export function specInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    specVersion: 1,
    title: 'Checkout 5xx',
    query: {
      refId: 'A',
      connector: 'prometheus',
      language: 'promql',
      expr: 'sum by (service) (rate(http_requests_total{code=~"5..",env="$env"}[1m]))',
    },
    variables: [{ name: 'env', value: 'prod' }],
    condition: { kind: 'threshold', op: 'above', value: 5, for: '5m' },
    every: '1m',
    lookback: '10m',
    severity: 'critical',
    channels: ['oncall'],
    message: { title: '{alert} fires for {series}', body: '{value} is {threshold} since {since}.' },
    ...overrides,
  };
}

/**
 * A parsed spec.
 *
 * @param overrides - Fields to replace.
 * @returns The spec.
 */
export function spec(overrides: Record<string, unknown> = {}): AlertSpec {
  return alertSpecSchema.parse(specInput(overrides));
}

/**
 * A time series frame as Prometheus returns it: time and value, the labels on the value.
 *
 * @param labels - The series labels.
 * @param points - Times and values.
 * @returns The frame.
 */
export function seriesFrame(
  labels: Record<string, string>,
  points: readonly (readonly [number, number])[],
): Frame {
  const fields: Field[] = [
    { name: 'time', type: 'time' },
    { name: 'Value', type: 'number', labels },
  ];
  const values = [points.map(([at]) => at), points.map(([, value]) => value)];
  return frameOf(fields, values);
}

/**
 * A frame from its fields and columns.
 *
 * @param fields - The fields.
 * @param values - One column per field.
 * @returns The frame.
 */
export function frameOf(fields: Field[], values: unknown[][]): Frame {
  const rowCount = values[0]?.length ?? 0;
  return { refId: 'A', fields, values, meta: { rowCount, truncated: false, durationMs: 0 } };
}

/** What the fake engine answers: frames, or a failure. */
export type FakeAnswer = readonly Frame[] | Error;

/**
 * A query engine that answers every query from a function, and records the requests.
 *
 * @param answer - The frames or failure for a request.
 * @returns The connectors' opener, the executor and the requests seen.
 */
export function fakeEngine(answer: (request: QueryRequest) => FakeAnswer) {
  const requests: QueryRequest[] = [];
  const executor: QueryExecutor = {
    run(_source, request) {
      requests.push(request);
      const result = answer(request);
      if (result instanceof Error)
        return Promise.reject(new QueryError('connector', result.message));
      const bound = { language: 'promql', expr: '', instant: false, stepSeconds: 60 } as const;
      return Promise.resolve({ frames: result, bound, cached: false });
    },
  };
  const openSource = (name: string): Promise<QuerySource> =>
    Promise.resolve({
      connectorId: name,
      version: 1,
      language: 'promql',
      instance: {} as QuerySource['instance'],
      guardrails: { timeoutMs: 1000, maxRows: 1000, maxRangeDays: 31 },
    });
  return { executor, openSource, requests };
}
