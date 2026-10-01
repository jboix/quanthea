import { describe, expect, test } from 'bun:test';
import type { Frame } from '@quanthea/plugin-kit/contract';
import { type Dataset, datasetSchema } from './contract.ts';
import { datasetOfFrames } from './from-frames.ts';
import {
  filterRows,
  fiveNumbers,
  histogramBins,
  longToWide,
  rowsToGraph,
  rowsToTree,
  sortRows,
  wideToLong,
} from './reshape.ts';

/**
 * A frame of one Prometheus series.
 *
 * @param labels - The series labels.
 * @param values - Its points, as time and value.
 * @returns The frame.
 */
function seriesFrame(labels: Record<string, string>, values: [number, number][]): Frame {
  return {
    refId: 'A',
    name: `up${JSON.stringify(labels)}`,
    fields: [
      { name: 'time', type: 'time' },
      { name: 'Value', type: 'number', labels },
    ],
    values: [values.map(([time]) => time), values.map(([, value]) => value)],
    meta: { rowCount: values.length, truncated: false, durationMs: 1 },
  };
}

const long: Dataset = {
  dimensions: [
    { name: 'day', type: 'string' },
    { name: 'status', type: 'string' },
    { name: 'orders', type: 'number', unit: 'EUR' },
  ],
  source: [
    ['Mon', 'paid', 10],
    ['Mon', 'failed', 2],
    ['Tue', 'paid', 12],
  ],
};

describe('the dataset contract', () => {
  test('refuses rows that do not fit the columns', () => {
    expect(datasetSchema.safeParse(long).success).toBe(true);
    const wrong = { ...long, source: [['Mon', 'paid', 'ten']] };
    expect(datasetSchema.safeParse(wrong).error?.issues[0]?.path).toEqual(['source', 0]);
  });
});

describe('datasetOfFrames', () => {
  test('stacks series frames into one long table with a column per label', () => {
    const frames = [
      seriesFrame({ code: '200' }, [[1000, 5]]),
      seriesFrame({ code: '500', job: 'api' }, [[1000, 1]]),
    ];
    expect(datasetOfFrames(frames)).toEqual({
      dimensions: [
        { name: 'time', type: 'time' },
        { name: 'code', type: 'string' },
        { name: 'job', type: 'string' },
        { name: 'series', type: 'string' },
        { name: 'value', type: 'number' },
      ],
      source: [
        [1000, '200', null, '200', 5],
        [1000, '500', 'api', '500 · api', 1],
      ],
    });
  });

  test('keeps one plain frame as it is', () => {
    const frame: Frame = {
      refId: 'A',
      fields: [
        { name: 'status', type: 'string' },
        { name: 'n', type: 'number' },
      ],
      values: [['paid'], [3]],
      meta: { rowCount: 1, truncated: false, durationMs: 1 },
    };
    expect(datasetOfFrames([frame]).source).toEqual([['paid', 3]]);
    expect(datasetOfFrames([]).source).toEqual([]);
  });
});

describe('reshaping', () => {
  test('turns long into wide and back', () => {
    const wide = longToWide(long, { x: 'day', series: 'status', value: 'orders' });
    expect(wide.dimensions.map((column) => column.name)).toEqual(['day', 'paid', 'failed']);
    expect(wide.dimensions[1]?.unit).toBe('EUR');
    expect(wide.source).toEqual([
      ['Mon', 10, 2],
      ['Tue', 12, null],
    ]);
    expect(wideToLong(wide, 'day', ['paid', 'failed']).source).toEqual([
      ['Mon', 'paid', 10],
      ['Mon', 'failed', 2],
      ['Tue', 'paid', 12],
      ['Tue', 'failed', null],
    ]);
  });

  test('builds a tree from level columns, summing repeated leaves', () => {
    expect(rowsToTree(long, ['day', 'status'], 'orders')).toEqual([
      {
        name: 'Mon',
        children: [
          { name: 'paid', value: 10 },
          { name: 'failed', value: 2 },
        ],
      },
      { name: 'Tue', children: [{ name: 'paid', value: 12 }] },
    ]);
  });

  test('builds a graph whose nodes come from the links', () => {
    const graph = rowsToGraph(long, { source: 'day', target: 'status', value: 'orders' });
    expect(graph.nodes).toEqual([
      { name: 'Mon', value: 12 },
      { name: 'paid', value: 22 },
      { name: 'failed', value: 2 },
      { name: 'Tue', value: 12 },
    ]);
    expect(graph.links[0]).toEqual({ source: 'Mon', target: 'paid', value: 10 });
  });

  test('bins numbers and summarises them in five numbers', () => {
    const values = [1, 2, 2, 3, 4, 5, 9, null];
    const bins = histogramBins(values, 4);
    expect(bins.map((bin) => bin.count)).toEqual([3, 2, 1, 1]);
    expect(bins[0]).toMatchObject({ start: 1, end: 3 });
    expect(fiveNumbers(values)).toEqual([1, 2, 3, 4.5, 9]);
    expect(fiveNumbers([])).toBeUndefined();
  });

  test('filters and sorts rows', () => {
    expect(filterRows(long, 'status', ['failed']).source).toEqual([['Mon', 'failed', 2]]);
    expect(sortRows(long, 'orders', 'desc').source.map((row) => row[2])).toEqual([12, 10, 2]);
  });
});
