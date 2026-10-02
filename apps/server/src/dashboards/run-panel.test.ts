import { describe, expect, test } from 'bun:test';
import { dashboardSpecSchema } from '@quanthea/shared';
import type { BoundQuery } from '../connectors/_shared/index.ts';
import { bindTemplate } from '../query/bind.ts';
import type { QueryExecutor, QuerySource } from '../query/executor.ts';
import { type RunnerDependencies, runPanel } from './run-panel.ts';

const guardrails = { timeoutMs: 10_000, maxRows: 50_000, maxRangeDays: 90 };

/** A chart of errors, marked with the deploys of `$service` from SQL and from PromQL. */
const spec = dashboardSpecSchema.parse({
  specVersion: 1,
  title: 'Errors',
  time: { from: 'now-1h', to: 'now' },
  variables: [
    {
      kind: 'query',
      name: 'service',
      source: { connector: 'shop', language: 'sql', sql: 'SELECT DISTINCT service FROM deploys' },
      default: 'checkout',
      multi: true,
    },
  ],
  annotations: [
    {
      id: 'deploys',
      label: 'deploy',
      query: {
        refId: 'M',
        connector: 'shop',
        language: 'sql',
        sql: 'SELECT at AS time, version AS text FROM deploys WHERE service IN (:service) AND at BETWEEN :__from AND :__to',
      },
      timeField: 'time',
      textField: 'text',
    },
    {
      id: 'restarts',
      label: 'restart',
      query: {
        refId: 'M',
        connector: 'prom',
        language: 'promql',
        expr: 'changes(process_start_time_seconds{service=~"$service"}[5m]) > 0',
      },
      timeField: 'time',
      textField: 'text',
    },
  ],
  panels: [
    {
      id: 'errors',
      title: 'Errors',
      grid: { x: 0, y: 0, w: 12, h: 6 },
      queries: [{ refId: 'A', connector: 'prom', language: 'promql', expr: 'up' }],
      view: {
        kind: 'chart',
        datasets: [{ ref: 'A' }],
        markers: [{ annotation: 'deploys' }, { annotation: 'restarts' }],
        option: { xAxis: { type: 'time' }, yAxis: { type: 'value' }, series: [{ type: 'line' }] },
      },
    },
  ],
});

/**
 * Runs the chart with the given variables through the real binders, and keeps what each connector
 * would receive.
 *
 * @param variables - The viewer's variable values.
 * @returns The bound queries of the deploys (SQL) and of the restarts (PromQL).
 */
async function boundWith(
  variables: Record<string, string | string[]>,
): Promise<{ sql: BoundQuery | undefined; promql: BoundQuery | undefined }> {
  const bound: BoundQuery[] = [];
  const executor: QueryExecutor = {
    run: async (_source, request) => {
      const query = bindTemplate(request.template, request.variables, request.timeRange);
      bound.push(query);
      return { frames: [], bound: query, cached: false };
    },
  };
  const dependencies: RunnerDependencies = {
    openSource: async (name) => ({ connectorId: name, guardrails }) as unknown as QuerySource,
    executor,
    now: () => Date.parse('2026-10-01T12:00:00Z'),
  };
  const run = await runPanel(dependencies, spec, 'errors', { variables });
  expect(run.markers.map((marker) => marker.error)).toEqual([null, null]);
  return {
    sql: bound.find((query) => query.language === 'sql'),
    promql: bound.find((query) => query.language === 'promql' && query.expr.startsWith('changes')),
  };
}

describe('markers that follow the variables', () => {
  test('bind the values the viewer chose, as parameters or escaped, never as query text', async () => {
    const { sql, promql } = await boundWith({ service: ['cart', "x') OR 1=1 --"] });
    expect(sql).toMatchObject({
      language: 'sql',
      text: 'SELECT at AS time, version AS text FROM deploys WHERE service IN ($1, $2) AND at BETWEEN $3 AND $4',
    });
    expect(sql?.language === 'sql' ? sql.parameters.slice(0, 2) : []).toEqual([
      'cart',
      "x') OR 1=1 --",
    ]);
    expect(promql).toMatchObject({
      language: 'promql',
      expr: String.raw`changes(process_start_time_seconds{service=~"cart|x'\\) OR 1=1 --"}[5m]) > 0`,
    });
  });

  test('take the default value when the viewer chose none', async () => {
    const { sql, promql } = await boundWith({});
    expect(sql?.language === 'sql' ? sql.parameters[0] : undefined).toBe('checkout');
    expect(promql).toMatchObject({ expr: expect.stringContaining('service=~"checkout"') });
  });
});
