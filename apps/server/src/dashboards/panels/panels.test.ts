import { describe, expect, test } from 'bun:test';
import { type Frame, planSchema } from '@querent/shared';
import { z } from 'zod';
import type { PanelTest } from '../dashboards.ts';
import { completeCharts } from './complete.ts';
import { applyEdit } from './edit.ts';
import { edit, firstBuild, issuesOf, specOf } from './fixtures.ts';
import { editRequestSchema, editRequestSchemaFor } from './request.ts';

/**
 * A test run of one panel: one frame of columns.
 *
 * @param panelId - The panel.
 * @param fields - The columns.
 * @param values - One array per column.
 * @returns The run.
 */
function testOf(panelId: string, fields: Frame['fields'], values: unknown[][]): PanelTest {
  const frame: Frame = {
    refId: 'A',
    fields,
    values,
    meta: { rowCount: values[0]?.length ?? 0, truncated: false, durationMs: 1 },
  };
  return {
    panelId,
    run: {
      time: { from: 0, to: 1 },
      queries: [{ refId: 'A', frames: [frame], error: null }],
      markers: [],
      durationMs: 1,
    },
  };
}

describe('applyEdit', () => {
  test('lays out numbers in a row and charts below, in reading order', () => {
    const grids = specOf(undefined, firstBuild).panels.map((panel) => [panel.id, panel.grid]);
    expect(grids).toEqual([
      ['error-rate', { x: 0, y: 0, w: 3, h: 3 }],
      ['failed-orders', { x: 3, y: 0, w: 3, h: 3 }],
      ['latency', { x: 0, y: 3, w: 12, h: 8 }],
      ['orders-by-status', { x: 0, y: 11, w: 12, h: 8 }],
      ['top-codes', { x: 0, y: 19, w: 6, h: 7 }],
    ]);
  });

  test('fills each chart recipe into the view, with its variants and the unit of the data', () => {
    const [errorRate, , latency, orders] = specOf(undefined, firstBuild).panels;
    expect(errorRate?.view).toMatchObject({
      kind: 'stat',
      reduce: 'max',
      format: { $fmt: 'percent', decimals: 1 },
    });
    expect(latency?.view).toMatchObject({
      kind: 'chart',
      recipe: { id: 'trend.line', variants: [] },
      prepare: 'cartesian',
      roles: { series: 'quantile' },
    });
    expect(orders?.view.kind === 'chart' && orders.view.option.series).toEqual([
      {
        type: 'line',
        showSymbol: false,
        encode: { x: '@x', y: '@y' },
        stack: 'total',
        areaStyle: { opacity: 0.45 },
      },
    ]);
  });

  test('rebuilds a panel in place, removes one, and adds below the rest', () => {
    const built = specOf(undefined, firstBuild);
    const changed = specOf(
      built,
      edit({
        remove: ['top-codes'],
        panels: [
          {
            title: 'p99',
            replaces: 'latency',
            data: {
              kind: 'latency',
              connector: 'prom',
              metric: 'http_request_duration_seconds',
              quantiles: [0.99],
            },
            chart: { recipe: 'trend.line' },
          },
          {
            title: 'Memory',
            data: { kind: 'gauge', connector: 'prom', metric: 'process_resident_memory_bytes' },
            chart: { recipe: 'trend.line', unit: 'bytes' },
          },
        ],
        summary: 'p99 only',
      }),
    );
    const latency = changed.panels.find((panel) => panel.id === 'latency');
    expect(latency?.title).toBe('p99');
    expect(latency?.grid).toEqual({ x: 0, y: 3, w: 12, h: 8 });
    expect(changed.panels.map((panel) => panel.id)).toEqual([
      'error-rate',
      'failed-orders',
      'latency',
      'orders-by-status',
      'memory',
    ]);
    expect(changed.panels.at(-1)?.grid).toEqual({ x: 0, y: 19, w: 12, h: 8 });
    expect(issuesOf(changed)).toEqual([]);
  });

  test('says which panels exist when an edit names another', () => {
    const built = specOf(undefined, firstBuild);
    expect(() => applyEdit(built, edit({ remove: ['nope'], summary: 'x' }))).toThrow(
      'No panel "nope". The panels are: error-rate, failed-orders, latency, orders-by-status, top-codes.',
    );
  });

  test('puts deploy markers on every time chart, and takes them off', () => {
    const markers = {
      label: 'deploy',
      connector: 'shop',
      table: 'deploys',
      time: 'deployed_at',
      text: 'version',
    };
    const marked = specOf(specOf(undefined, firstBuild), edit({ markers, summary: 'markers' }));
    const markedIds = marked.panels
      .filter((panel) => panel.view.kind === 'chart' && panel.view.markers?.length)
      .map((panel) => panel.id);
    expect(markedIds).toEqual(['latency', 'orders-by-status']);
    expect(issuesOf(marked)).toEqual([]);
    const cleared = specOf(marked, edit({ markers: null, summary: 'no markers' }));
    expect(cleared.annotations).toEqual([]);
    expect(cleared.panels.some((panel) => panel.view.kind === 'chart' && panel.view.markers)).toBe(
      false,
    );
  });

  test('needs a title for a new dashboard, and a chart recipe that exists', () => {
    expect(() => applyEdit(undefined, edit({ summary: 'x' }))).toThrow(
      'Give the new dashboard a title.',
    );
    const panel = {
      title: 'x',
      data: { kind: 'sql-stat', connector: 'shop', table: 'orders' },
      chart: { recipe: 'kpi.nope' },
    };
    expect(editRequestSchema.safeParse({ title: 'x', panels: [panel], summary: 'x' }).success).toBe(
      false,
    );
  });
});

describe('completeCharts', () => {
  test('fills the roles the agent left out from the columns the data returns', () => {
    const { spec, charts } = applyEdit(undefined, firstBuild);
    const tests = [
      testOf(
        'orders-by-status',
        [
          { name: 'time', type: 'time' },
          { name: 'series', type: 'string' },
          { name: 'value', type: 'number' },
        ],
        [[1], ['paid'], [3]],
      ),
      testOf('failed-orders', [{ name: 'value', type: 'number' }], [[4]]),
    ];
    const completed = completeCharts(spec, charts, tests);
    const orders = completed.spec.panels.find((panel) => panel.id === 'orders-by-status');
    expect(orders?.view.kind === 'chart' && orders.view.roles).toEqual({
      x: 'time',
      series: 'series',
      y: ['value'],
    });
    const failed = completed.spec.panels.find((panel) => panel.id === 'failed-orders');
    expect(failed?.view).toMatchObject({ kind: 'stat', field: 'value' });
    expect(completed.problems.size).toBe(0);
  });

  test('says when a role names a column the data has not', () => {
    const request = edit({
      title: 'x',
      panels: [
        {
          title: 'Orders',
          data: { kind: 'sql-series', connector: 'shop', table: 'orders', time: 'created_at' },
          chart: { recipe: 'trend.line', roles: { y: 'total' } },
        },
      ],
      summary: 'x',
    });
    const { spec, charts } = applyEdit(undefined, request);
    const tests = [
      testOf(
        'orders',
        [
          { name: 'time', type: 'time' },
          { name: 'value', type: 'number' },
        ],
        [[1], [2]],
      ),
    ];
    expect(completeCharts(spec, charts, tests).problems.get('orders')).toEqual([
      'The y role names "total", which the data has not.',
    ]);
  });
});

describe('the tool schemas', () => {
  test('have no reference loops, which Gemini refuses, and stay small', () => {
    for (const schema of [editRequestSchema, planSchema]) {
      const json = JSON.stringify(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }));
      expect(json).not.toContain('$ref');
    }
    const full = JSON.stringify(
      z.toJSONSchema(editRequestSchemaFor({ builtIn: ['rate', 'sql-stat'], saved: [] }), {
        io: 'input',
        unrepresentable: 'any',
      }),
    );
    expect(full.length).toBeLessThan(16_000);
  });

  test('offer only the chart recipes switched on', () => {
    const schema = editRequestSchemaFor({ builtIn: [], saved: [] }, ['trend.line', 'kpi.stat']);
    const json = JSON.stringify(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }));
    expect(json).toContain('"trend.line"');
    expect(json).not.toContain('"geo.choropleth"');
    const panel = {
      title: 'x',
      data: { kind: 'raw', connector: 'shop', language: 'sql', query: 'SELECT 1' },
      chart: { recipe: 'geo.choropleth' },
    };
    expect(schema.safeParse({ title: 'x', panels: [panel], summary: 'x' }).success).toBe(false);
  });
});
