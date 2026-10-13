import { describe, expect, test } from 'bun:test';
import { init, use } from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import { buildChartOption } from './build-option.ts';
import {
  denseLinePoints,
  largeBarPoints,
  largeScatterPoints,
  stillPoints,
  withDensity,
} from './dense.ts';
import type { Loose } from './loose.ts';
import './register.ts';
import { speedDataset, speedView } from './speed/speed-data.ts';
import { defaultTheme } from './theme.ts';

use([SVGRenderer]);

/**
 * An option with one series of a number of points, read from a dataset.
 *
 * @param type - The series type.
 * @param points - How many rows the dataset has.
 * @param more - More keys of the series.
 * @returns The option.
 */
function optionOf(type: string, points: number, more: Loose = {}): Loose {
  const source = Array.from({ length: points }, (_row, index) => [index, index]);
  return { dataset: [{ source }], series: [{ type, datasetIndex: 0, ...more }] };
}

/**
 * The first series of an option after the density rules.
 *
 * @param option - The option.
 * @returns The series.
 */
function firstSeries(option: Loose): Loose {
  return (withDensity(option).series as Loose[])[0] ?? {};
}

describe('a line', () => {
  test('is left as it is up to the limit', () => {
    const series = firstSeries(optionOf('line', denseLinePoints, { showSymbol: true }));
    expect(series).toEqual({ type: 'line', datasetIndex: 0, showSymbol: true });
  });

  test('past the limit is sampled by the lowest and highest point of each pixel, without symbols', () => {
    const series = firstSeries(optionOf('line', denseLinePoints + 1, { showSymbol: true }));
    expect(series).toMatchObject({ sampling: 'minmax', showSymbol: false });
  });

  test('counts the points of its own data when it has some', () => {
    const data = Array.from({ length: denseLinePoints + 1 }, (_point, index) => [index, index]);
    expect(firstSeries({ series: [{ type: 'line', data }] }).sampling).toBe('minmax');
  });

  test('counts the rows of the dataset it reads, not of another', () => {
    const long = optionOf('line', denseLinePoints + 1).dataset as Loose[];
    const option = {
      dataset: [{ source: [[0, 0]] }, ...long],
      series: [
        { type: 'line', datasetIndex: 0 },
        { type: 'line', datasetIndex: 1 },
      ],
    };
    const series = withDensity(option).series as Loose[];
    expect(series.map((each) => each.sampling)).toEqual([undefined, 'minmax']);
  });
});

describe('a line with a missing value', () => {
  /**
   * A wide dataset of two columns over time: a full one and one with a missing value.
   *
   * @returns The option, one line per column.
   */
  function sparseOption(): Loose {
    const source = Array.from({ length: denseLinePoints + 1 }, (_row, index) => [
      index,
      index,
      index === 7 ? null : index,
    ]);
    const line = (y: string) => ({ type: 'line', datasetIndex: 0, encode: { x: 'time', y } });
    return {
      dataset: [{ dimensions: ['time', '200', '500'], source }],
      series: [line('200'), line('500')],
    };
  }

  test('is drawn in full: the sampler would drop the points of a pixel that starts on it', () => {
    const [full, sparse] = withDensity(sparseOption()).series as Loose[];
    expect(full).toMatchObject({ sampling: 'minmax', showSymbol: false });
    expect(sparse?.sampling).toBeUndefined();
    expect(sparse?.showSymbol).toBeUndefined();
  });

  test('is found in its own data, and in any column when the series names none', () => {
    const data = Array.from({ length: denseLinePoints + 1 }, (_point, index) => [index, index]);
    const holed = data.map((point, index) => (index === 3 ? [index, null] : point));
    expect(firstSeries({ series: [{ type: 'line', data: holed }] }).sampling).toBeUndefined();
    const { dataset } = sparseOption();
    const unnamed = { dataset, series: [{ type: 'line', datasetIndex: 0 }] };
    expect(firstSeries(unnamed).sampling).toBeUndefined();
  });
});

describe('bars and points', () => {
  test('bars switch to large mode past their limit', () => {
    expect(firstSeries(optionOf('bar', largeBarPoints)).large).toBeUndefined();
    expect(firstSeries(optionOf('bar', largeBarPoints + 1))).toMatchObject({
      large: true,
      largeThreshold: largeBarPoints,
    });
  });

  test('points switch to large mode past their limit', () => {
    expect(firstSeries(optionOf('scatter', largeScatterPoints)).large).toBeUndefined();
    expect(firstSeries(optionOf('scatter', largeScatterPoints + 1))).toMatchObject({
      large: true,
      largeThreshold: largeScatterPoints,
    });
  });

  test('a series coloured or sized by its values, or stacked, keeps the usual drawing', () => {
    const many = largeScatterPoints + 1;
    const mapped = { ...optionOf('scatter', many), visualMap: { dimension: 1 } };
    expect(firstSeries(mapped).large).toBeUndefined();
    expect(firstSeries(optionOf('scatter', many, { symbolSize: [4, 9] })).large).toBeUndefined();
    expect(firstSeries(optionOf('bar', many, { stack: 'total' })).large).toBeUndefined();
    expect(firstSeries(optionOf('scatter', many, { symbolSize: 9 })).large).toBe(true);
  });

  test('other chart types are left alone', () => {
    const series = firstSeries(optionOf('heatmap', 50_000));
    expect(series).toEqual({ type: 'heatmap', datasetIndex: 0 });
  });
});

describe('animation', () => {
  test('stays up to the limit, counted over every series', () => {
    const half = optionOf('scatter', stillPoints / 2);
    const two = { ...half, series: [...(half.series as Loose[]), ...(half.series as Loose[])] };
    expect(withDensity(two).animation).toBeUndefined();
  });

  test('is off past the limit', () => {
    expect(withDensity(optionOf('scatter', stillPoints + 1)).animation).toBe(false);
  });

  test('an option without series is returned as it is', () => {
    const option = { title: { text: 'No data' } };
    expect(withDensity(option)).toBe(option);
  });
});

describe('a long line as ECharts draws it', () => {
  /** How many spikes and dips the drawn series has: one of each, side by side, every 1000 points. */
  const pairs = 20;

  /**
   * The heights ECharts draws the page's line of 20,000 points at, 640 pixels wide, with a spike
   * and a dip side by side every 1000 points.
   *
   * @param holes - The places of the points that are missing.
   * @param shift - How many points later each spike and dip comes.
   * @returns The vertical pixel of each point drawn, in order.
   */
  function drawnHeights(holes: readonly number[] = [], shift = 0): number[] {
    const dataset = speedDataset(pairs * 1000, 1);
    const source = dataset.source.map(([time = null, value = null], index) => {
      if (holes.includes(index)) return [time, null];
      if ((index - shift) % 1000 === 400) return [time, 500];
      return [time, (index - shift) % 1000 === 401 ? -50 : value];
    });
    const input = { view: speedView('line'), datasets: [{ ...dataset, source }], markers: [] };
    const option = buildChartOption(input, { theme: defaultTheme, timeZone: 'UTC' });
    const chart = init(null, null, { renderer: 'svg', ssr: true, width: 640, height: 320 });
    try {
      chart.setOption(option);
      const paths = [...chart.renderToSVGString().matchAll(/ d="([^"]+)"/g)];
      const line = paths.map((match) => match[1] ?? '').sort((a, b) => b.length - a.length)[0];
      return [...(line ?? '').matchAll(/[ML]\s*[-\d.]+[ ,]([-\d.]+)/g)].map((match) =>
        Number(match[1]),
      );
    } finally {
      chart.dispose();
    }
  }

  test('draws about two points a pixel, and every spike and every dip beside it', () => {
    const heights = drawnHeights();
    expect(heights.length).toBeGreaterThan(600);
    expect(heights.length).toBeLessThan(1400);
    const [top, bottom] = [Math.min(...heights), Math.max(...heights)];
    expect(heights.filter((height) => height === top)).toHaveLength(pairs);
    expect(heights.filter((height) => height === bottom)).toHaveLength(pairs);
  });

  test('keeps a spike that follows a missing value, wherever a pixel starts', () => {
    const lost: number[] = [];
    for (let offset = 0; offset < 64; offset += 1) {
      const heights = drawnHeights([12_399 + offset], offset);
      const top = Math.min(...heights);
      if (heights.filter((height) => height === top).length !== pairs) lost.push(offset);
    }
    expect(lost).toEqual([]);
  });
});
