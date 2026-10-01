import { describe, expect, test } from 'bun:test';
import {
  type ChartView,
  chartRecipe,
  type Field,
  type Frame,
  fillView,
  type QueryOutcome,
} from '@quanthea/shared';
import { buildChartOption, chartInputOf } from './build-option.ts';

import { defaultTheme } from './theme.ts';

const t0 = Date.parse('2026-09-26T12:00:00Z');

/**
 * A frame from columns.
 *
 * @param fields - The fields.
 * @param values - One array per field.
 * @returns The frame.
 */
function frame(fields: Field[], values: unknown[][]): Frame {
  const rowCount = values[0]?.length ?? 0;
  return { refId: 'A', fields, values, meta: { rowCount, truncated: false, durationMs: 1 } };
}

/**
 * A Prometheus range series for one service.
 *
 * @param service - The service label.
 * @param rates - The values at t0, t0+1m, ….
 * @returns The frame.
 */
function series(service: string, rates: number[]): Frame {
  return frame(
    [
      { name: 'Time', type: 'time' },
      { name: 'Value', type: 'number', labels: { service } },
    ],
    [rates.map((_rate, index) => t0 + index * 60_000), rates],
  );
}

/**
 * Builds an option in UTC with the default theme.
 *
 * @param option - The spec's ECharts option.
 * @param frames - The frames of query A.
 * @param extra - More of the view, such as datasets with transforms.
 * @returns The option.
 */
function build(option: ChartView['option'], frames: Frame[], extra: Partial<ChartView> = {}) {
  const view: ChartView = {
    kind: 'chart',
    prepare: 'cartesian',
    roles: {},
    option,
    datasets: [{ ref: 'A' }],
    ...extra,
  };
  const queries: QueryOutcome[] = [{ refId: 'A', frames, error: null }];
  const markers = [
    {
      annotation: 'deploys',
      label: 'deploy',
      points: [{ time: t0 + 120_000, text: 'deploy #481' }],
      error: null,
    },
  ];
  return buildChartOption(chartInputOf(view, queries, markers), {
    theme: defaultTheme,
    timeZone: 'UTC',
  });
}

/**
 * Reads a value deep in an option.
 *
 * @param option - The option.
 * @param path - Dotted keys and indexes, such as `series.0.name`.
 * @returns The value.
 */
function at(option: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], option);
}

/**
 * Calls a formatter deep in an option.
 *
 * @param option - The option.
 * @param path - Where the formatter is.
 * @param value - The value to format.
 * @returns The text.
 */
function formatWith(option: unknown, path: string, value: unknown): string {
  return (at(option, path) as (input: unknown) => string)(value);
}

/**
 * Picks keys from each series.
 *
 * @param option - The option.
 * @param keys - The keys.
 * @returns One array of values per series.
 */
function seriesKeys(option: unknown, ...keys: string[]): unknown[][] {
  const series = at(option, 'series') as Record<string, unknown>[];
  return series.map((each) => keys.map((key) => each[key]));
}

const lineOption: ChartView['option'] = {
  xAxis: { type: 'time' },
  yAxis: {
    type: 'value',
    axisLabel: { formatter: { $fmt: 'percent', decimals: 1, input: 'ratio' } },
  },
  legend: { top: 0 },
  series: [{ type: 'line', showSymbol: false }],
};

describe('buildChartOption', () => {
  test('draws one series per frame, named by its labels, from one pivoted dataset', () => {
    const option = build(lineOption, [
      series('checkout-svc', [0.003, 0.084]),
      series('payments-svc', [0.002, 0.02]),
    ]);
    expect(at(option, 'dataset')).toEqual([
      {
        dimensions: ['Time', 'checkout-svc', 'payments-svc'],
        source: [
          [t0, 0.003, 0.002],
          [t0 + 60_000, 0.084, 0.02],
        ],
      },
    ]);
    expect(seriesKeys(option, 'name', 'datasetIndex', 'encode', 'showSymbol')).toEqual([
      ['checkout-svc', 0, { x: 'Time', y: 'checkout-svc' }, false],
      ['payments-svc', 0, { x: 'Time', y: 'payments-svc' }, false],
    ]);
  });

  test('turns named formatters into functions and formats times in the dashboard zone', () => {
    const option = build(lineOption, [series('checkout-svc', [0.084])]);
    expect(formatWith(option, 'yAxis.axisLabel.formatter', 0.084)).toBe('8.4%');
    expect(formatWith(option, 'xAxis.axisLabel.formatter', t0 + 120_000)).toBe('12:02');
    expect(at(option, 'yAxis.axisLabel.color')).toBe(defaultTheme.inkSecondary);
  });

  test('marks annotations on the first series with their time and text', () => {
    const option = build(lineOption, [series('checkout-svc', [1]), series('payments-svc', [1])]);
    expect(at(option, 'series.0.markLine.data')).toEqual([
      { xAxis: t0 + 120_000, name: '12:02 deploy #481' },
    ]);
    expect(at(option, 'series.1.markLine')).toBeUndefined();
  });

  test('renders tooltips as rich text, so a hostile series name stays text', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const option = build({ ...lineOption, tooltip: { trigger: 'axis' } }, [series(hostile, [1])]);
    expect(at(option, 'tooltip')).toMatchObject({
      renderMode: 'richText',
      confine: true,
      trigger: 'axis',
    });
    expect(at(option, 'series.0.name')).toBe(hostile);
    expect(JSON.stringify(option)).not.toContain('"html"');
  });

  test('keeps the parts the adapter owns, whatever the option says', () => {
    const option = build({ ...lineOption, grid: { left: 500 }, color: ['#000'] }, [
      series('a', [1]),
    ]);
    expect(at(option, 'grid.left')).toBe(8);
    expect(at(option, 'color')).toEqual(defaultTheme.palette);
  });

  test('draws a horizontal bar chart from a table, with categories on the y axis', () => {
    const codes = frame(
      [
        { name: 'code', type: 'string' },
        { name: 'count', type: 'number' },
      ],
      [
        ['502', '504'],
        [18_412, 6108],
      ],
    );
    const option = build(
      { xAxis: { type: 'value' }, yAxis: { type: 'category' }, series: [{ type: 'bar' }] },
      [codes],
    );
    expect(at(option, 'series')).toMatchObject([
      { type: 'bar', encode: { y: 'code', x: 'count' } },
    ]);
    expect(at(option, 'series.0.markLine')).toBeUndefined();
  });

  test('filters a dataset to the rows of some values', () => {
    const long = frame(
      [
        { name: 'time', type: 'time' },
        { name: 'service', type: 'string' },
        { name: 'failed', type: 'number' },
      ],
      [
        [t0, t0, t0 + 60_000, t0 + 60_000],
        ['checkout', 'payments', 'checkout', 'payments'],
        [3, 1, 9, 2],
      ],
    );
    const filtered = build(
      { xAxis: { type: 'category' }, yAxis: { type: 'value' }, series: { type: 'bar' } },
      [long],
      {
        datasets: [{ ref: 'A', transform: { type: 'filter', field: 'service', in: ['payments'] } }],
      },
    );
    expect(at(filtered, 'dataset.0.source')).toEqual([
      [t0, 'payments', 1],
      [t0 + 60_000, 'payments', 2],
    ]);
  });

  test('encodes a pie by name and value, with an item tooltip', () => {
    const codes = frame(
      [
        { name: 'code', type: 'string' },
        { name: 'count', type: 'number' },
      ],
      [['502'], [18_412]],
    );
    const option = build({ series: [{ type: 'pie' }] }, [codes]);
    expect(at(option, 'series.0.encode')).toEqual({ itemName: 'code', value: 'count' });
    expect(at(option, 'tooltip.trigger')).toBe('item');
  });

  test('says there is no data for a failed query', () => {
    const view: ChartView = {
      kind: 'chart',
      prepare: 'cartesian',
      roles: {},
      option: lineOption,
      datasets: [{ ref: 'A' }],
    };
    const queries = [
      { refId: 'A', frames: [], error: { code: 'timeout' as const, message: 'Too slow.' } },
    ];
    const option = buildChartOption(chartInputOf(view, queries, []), { theme: defaultTheme });
    expect(at(option, 'title.text')).toBe('No data in this range');
    expect(at(option, 'dataset.0.source')).toEqual([]);
  });

  test('drops the numbers and borders of a heatmap too dense to show them', () => {
    const recipe = chartRecipe('relationship.heatmap');
    if (!recipe) throw new Error('No heatmap recipe.');
    const filled = fillView(
      recipe,
      { recipe: recipe.id, roles: { x: 'time', y: 'service', value: 'value' } },
      ['A'],
    );
    if (!('view' in filled) || filled.view.kind !== 'chart') throw new Error('Expected a chart.');
    const source = Array.from({ length: 60 }, (_row, index) => [t0 + index * 60_000, 'api', index]);
    const dataset = {
      dimensions: [
        { name: 'time', type: 'time' as const },
        { name: 'service', type: 'string' as const },
        { name: 'value', type: 'number' as const },
      ],
      source,
    };
    const option = buildChartOption(
      { view: filled.view, datasets: [dataset], markers: [] },
      { theme: defaultTheme, timeZone: 'UTC' },
    );
    expect(at(option, 'series.0.label')).toEqual({ show: false });
    expect(at(option, 'series.0.itemStyle.borderWidth')).toBe(0);
    expect(at(option, 'visualMap.max')).toBe(59);
  });
});
