import { describe, expect, test } from 'bun:test';
import { dashboardSpecSchema } from '@quanthea/shared';
import type { QueryExecutor, QueryRequest, QuerySource } from '../query/executor.ts';
import { chartPointsOf, pointsPerGridColumn } from './chart-points.ts';
import { atLayoutPlaces } from './context.ts';
import { type RunnerDependencies, runPanel } from './run-panel.ts';

const up = { refId: 'A', connector: 'prom', language: 'promql', expr: 'up' };

/** A time chart with a marker, a chart of categories, a stat and a table, all on one query. */
const spec = dashboardSpecSchema.parse({
  specVersion: 1,
  title: 'Traffic',
  time: { from: 'now-24h', to: 'now' },
  annotations: [
    {
      id: 'restarts',
      label: 'restart',
      query: { ...up, refId: 'M', expr: 'changes(process_start_time_seconds[5m]) > 0' },
      timeField: 'time',
      textField: 'text',
    },
  ],
  panels: [
    {
      id: 'trend',
      title: 'Trend',
      grid: { x: 0, y: 0, w: 6, h: 6 },
      queries: [up],
      view: {
        kind: 'chart',
        datasets: [{ ref: 'A' }],
        markers: [{ annotation: 'restarts' }],
        option: { xAxis: { type: 'time' }, yAxis: { type: 'value' }, series: [{ type: 'line' }] },
      },
    },
    {
      id: 'ranking',
      title: 'Ranking',
      grid: { x: 6, y: 0, w: 6, h: 6 },
      queries: [up],
      view: {
        kind: 'chart',
        datasets: [{ ref: 'A' }],
        option: {
          xAxis: { type: 'category' },
          yAxis: { type: 'value' },
          series: [{ type: 'bar' }],
        },
      },
    },
    {
      id: 'now',
      title: 'Now',
      grid: { x: 0, y: 6, w: 3, h: 3 },
      queries: [up],
      view: { kind: 'stat', ref: 'A', reduce: 'last', format: { $fmt: 'number' } },
    },
    {
      id: 'rows',
      title: 'Rows',
      grid: { x: 3, y: 6, w: 9, h: 3 },
      queries: [up],
      view: { kind: 'table', ref: 'A', columns: [{ field: 'value' }] },
    },
  ],
});

/**
 * Runs a panel and keeps what the query engine was asked.
 *
 * @param panelId - The panel.
 * @param interval - The interval the caller chose, if any.
 * @param from - The spec to run the panel of.
 * @returns The requests, by the name of their result.
 */
async function requestsOf(panelId: string, interval?: string, from = spec) {
  const requests: Record<string, QueryRequest> = {};
  const executor: QueryExecutor = {
    run: async (_source, request) => {
      requests[request.refId] = request;
      return { frames: [], bound: { language: 'promql', expr: '' } as never, cached: false };
    },
  };
  const dependencies: RunnerDependencies = {
    openSource: async (name) => ({ connectorId: name }) as unknown as QuerySource,
    executor,
    now: () => Date.parse('2026-10-01T12:00:00Z'),
  };
  await runPanel(dependencies, from, panelId, { variables: {}, interval });
  return requests;
}

describe('the points a panel asks for', () => {
  test('are 200 a grid column for a chart over time', () => {
    const [trend] = spec.panels;
    expect(pointsPerGridColumn).toBe(200);
    expect(trend && chartPointsOf(trend)).toBe(1200);
  });

  test('are none for a chart of categories, a stat or a table', () => {
    expect(spec.panels.slice(1).map(chartPointsOf)).toEqual([undefined, undefined, undefined]);
  });
});

describe('a run', () => {
  test('asks the queries of a time chart for the points its width shows, not its markers', async () => {
    const requests = await requestsOf('trend');
    expect(requests.A?.chartPoints).toBe(1200);
    expect(requests.M).toBeDefined();
    expect(requests.M?.chartPoints).toBeUndefined();
  });

  test('asks a stat, a table and a chart of categories for what their queries return', async () => {
    for (const panelId of ['ranking', 'now', 'rows'])
      expect((await requestsOf(panelId)).A?.chartPoints).toBeUndefined();
  });

  test('leaves the interval to the caller that chose one, as a run of a report does', async () => {
    const requests = await requestsOf('trend', '1m');
    expect(requests.A).toMatchObject({ interval: '1m' });
    expect(requests.A?.chartPoints).toBeUndefined();
  });

  test('gives a chosen interval to charts only: a stat and a table reduce what they read', async () => {
    expect((await requestsOf('ranking', '10m')).A).toMatchObject({ interval: '10m' });
    for (const panelId of ['now', 'rows'])
      expect((await requestsOf(panelId, '10m')).A?.interval).toBeUndefined();
  });

  test('follows the width a layout gives the panel, hidden or not', async () => {
    const layout = {
      panels: [
        { id: 'trend', grid: { x: 0, y: 0, w: 12, h: 6 }, hidden: true },
        { id: 'now', grid: { x: 0, y: 6, w: 4, h: 3 }, hidden: false },
      ],
    };
    const placed = atLayoutPlaces(spec, layout);
    expect(placed.panels.map((panel) => panel.grid.w)).toEqual([12, 6, 4, 9]);
    expect((await requestsOf('trend', undefined, placed)).A?.chartPoints).toBe(2400);
    expect(atLayoutPlaces(spec, undefined)).toEqual(spec);
  });
});
