import { expect, test } from 'bun:test';
import { init, use } from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import { type AlertChartInput, buildAlertOption, thresholdBounds } from './alert-option.ts';
import './register.ts';
import { defaultTheme } from './theme.ts';

use([SVGRenderer]);

const input = {
  series: [
    { name: 'checkout', points: [{ at: 0, value: 1 }] },
    { name: 'cart', points: [{ at: 0, value: 2 }] },
  ],
  threshold: 5,
  firing: [{ from: 10, to: 20 }],
  format: (value: number) => `${value}%`,
  from: 0,
  to: 100,
};

/** The mark line of the first series, as the tests read it. */
type MarkLine = {
  data: { yAxis: number; label: { show?: boolean; formatter: () => string } }[];
  lineStyle: { color: string };
};

/**
 * The mark line an option draws on its first series.
 *
 * @param option - The option.
 * @returns The mark line, if any.
 */
function markLineOf(option: Record<string, unknown>): MarkLine | undefined {
  const [first] = option.series as Record<string, unknown>[];
  return first?.markLine as MarkLine | undefined;
}

/**
 * Draws a chart as SVG and finds where its dashed threshold line lies.
 *
 * @param chartInput - What the chart draws.
 * @param value - The value whose height on the axis is wanted.
 * @returns The line's height at both ends, and the value's height, in pixels.
 */
function drawnLine(chartInput: AlertChartInput, value: number) {
  const chart = init(null, null, { renderer: 'svg', ssr: true, width: 640, height: 320 });
  try {
    chart.setOption(buildAlertOption(chartInput, defaultTheme, 'UTC'));
    const svg = chart.renderToSVGString();
    const dashed = /<path d="M\S+ (\S+)L\S+ (\S+)"[^>]*stroke-dasharray/.exec(svg);
    const expected = Number(chart.convertToPixel({ yAxisIndex: 0 }, value));
    return { start: Number(dashed?.[1]), end: Number(dashed?.[2]), expected };
  } finally {
    chart.dispose();
  }
}

test('draws the threshold and the firing periods on the first series, in the danger colour', () => {
  const option = buildAlertOption(input, defaultTheme, 'UTC');
  const [first, second] = option.series as Record<string, unknown>[];
  const markLine = markLineOf(option);
  expect(markLine?.data.map((each) => each.yAxis)).toEqual([5]);
  expect(markLine?.lineStyle.color).toBe(defaultTheme.danger);
  expect(markLine?.data[0]?.label.formatter()).toBe('5%');
  expect(first?.markArea).toMatchObject({ data: [[{ xAxis: 10 }, { xAxis: 20 }]] });
  expect(second?.markLine).toBeUndefined();
  expect(option.legend).toBeDefined();
});

test('draws the threshold line at its exact value, not rounded to two decimals', () => {
  const ratio = {
    ...input,
    series: [{ name: 'checkout', points: [0, 1, 2, 3].map((at) => ({ at, value: 0.01 * at })) }],
    threshold: 0.0231,
    to: 3,
  };
  const drawn = drawnLine(ratio, 0.0231);
  expect(drawn.start).toBeCloseTo(drawn.expected, 0);
  expect(drawn.end).toBeCloseTo(drawn.expected, 0);
  expect(Math.abs(drawn.start - drawnLine(ratio, 0.02).expected)).toBeGreaterThan(5);
});

test('keeps the threshold in view and tooltips on the canvas', () => {
  const option = buildAlertOption(input, defaultTheme, 'UTC');
  expect(option.yAxis).toMatchObject({ max: 6 });
  expect(thresholdBounds({ ...input, threshold: 1.5 })).toEqual({});
  expect(thresholdBounds({ ...input, threshold: 0.2 })).toEqual({ min: 0 });
  expect(thresholdBounds({ ...input, threshold: 0.02, series: [] })).toEqual({ max: 0.025 });
  expect(option.tooltip).toMatchObject({ renderMode: 'richText' });
  const without = buildAlertOption({ ...input, threshold: null }, defaultTheme);
  expect(markLineOf(without)).toBeUndefined();
  expect(without.yAxis).not.toHaveProperty('max');
});

test('moves the line where a person moved it, the saved one faint, the axis kept on it', () => {
  const option = buildAlertOption({ ...input, moved: 4, handle: true }, defaultTheme, 'UTC');
  const markLine = markLineOf(option);
  expect(markLine?.data.map((each) => each.yAxis)).toEqual([4, 5]);
  expect(markLine?.data[0]?.label.show).toBe(false);
  expect(markLine?.data[1]?.label.formatter()).toBe('was 5%');
  expect(option.yAxis).toMatchObject({ max: 6 });
  expect(option.grid).toMatchObject({ right: 72 });
  // Moved past the values, the axis keeps the line in view too.
  expect(thresholdBounds({ ...input, moved: 8 })).toEqual({ max: 10 });
  expect(thresholdBounds({ ...input, threshold: 1.5, moved: 0.2 })).toEqual({ min: 0 });
  // While it is dragged, the axis keeps where the drag started.
  expect(thresholdBounds({ ...input, moved: 8, axisMoved: 5 })).toEqual({ max: 6 });
});

test('keeps a threshold that falls on a round step a step below the top', () => {
  const ratio = { ...input, series: [{ name: 'a', points: [{ at: 0, value: 0.034 }] }] };
  expect(thresholdBounds({ ...ratio, threshold: 0.04 }).max).toBeCloseTo(0.042, 9);
});

test('draws the limit of a change as a dashed line after the series, in the danger colour', () => {
  const points = [
    { at: 0, value: null },
    { at: 50, value: 0.5 },
  ];
  const option = buildAlertOption(
    { ...input, threshold: null, limit: { name: 'fires below (checkout)', points } },
    defaultTheme,
  );
  const series = option.series as {
    name: string;
    data: unknown[];
    lineStyle?: { type: string; color: string };
  }[];
  expect(series.map((each) => each.name)).toEqual(['checkout', 'cart', 'fires below (checkout)']);
  expect(series[2]?.lineStyle).toMatchObject({ type: 'dashed', color: defaultTheme.danger });
  expect(series[2]?.data).toEqual([
    [0, null],
    [50, 0.5],
  ]);
  expect((buildAlertOption(input, defaultTheme).series as unknown[]).length).toBe(2);
});

test('draws the value a period before as a dotted line in the secondary ink', () => {
  const points = [{ at: 0, value: 3 }];
  const option = buildAlertOption(
    { ...input, threshold: null, reference: { name: 'a week earlier', points } },
    defaultTheme,
  );
  const series = option.series as { name: string; lineStyle?: Record<string, unknown> }[];
  expect(series.map((each) => each.name)).toEqual(['checkout', 'cart', 'a week earlier']);
  expect(series[2]?.lineStyle).toMatchObject({ type: 'dotted', color: defaultTheme.inkSecondary });
  const alone = { ...input, series: input.series.slice(0, 1), threshold: null };
  expect(buildAlertOption(alone, defaultTheme)).not.toHaveProperty('legend');
  const compared = { ...alone, reference: { name: 'a week earlier', points } };
  expect(buildAlertOption(compared, defaultTheme)).toHaveProperty('legend');
});

test('shades a band between its edges, below zero too, and names the upper edge', () => {
  const band = {
    name: 'usual range',
    points: [
      { at: 0, lower: -2, upper: 4 },
      { at: 50, lower: -2, upper: 4 },
      { at: 100, lower: null, upper: null },
    ],
  };
  const chartInput = { ...input, threshold: null, band };
  const option = buildAlertOption(chartInput, defaultTheme, 'UTC');
  const series = option.series as {
    name: string;
    data: unknown[];
    tooltip?: { valueFormatter: (value: unknown, index: number) => string };
  }[];
  expect(series.map((each) => each.name)).toEqual([
    'checkout',
    'cart',
    'usual range, from',
    'usual range, to',
  ]);
  expect(series[3]?.data).toEqual([
    [0, 6],
    [50, 6],
    [100, null],
  ]);
  expect(series[3]?.tooltip?.valueFormatter(6, 0)).toBe('4%');
  expect(series[3]?.tooltip?.valueFormatter(null, 2)).toBe('–');
  const legend = option.legend as { data: string[]; formatter: (name: string) => string };
  expect(legend.data.map(legend.formatter)).toEqual(['checkout', 'cart', 'usual range']);
  const chart = init(null, null, { renderer: 'svg', ssr: true, width: 640, height: 320 });
  try {
    chart.setOption(option);
    const svg = chart.renderToSVGString();
    const top = Number(chart.convertToPixel({ yAxisIndex: 0 }, 4));
    const bottom = Number(chart.convertToPixel({ yAxisIndex: 0 }, -2));
    const area = /<path d="M(\S+) (\S+)L(\S+) (\S+)L(\S+) (\S+)L(\S+) (\S+)Z"/.exec(svg);
    const heights = [area?.[2], area?.[4], area?.[6], area?.[8]].map(Number);
    expect(heights[0]).toBeCloseTo(top, 3);
    expect(heights[1]).toBeCloseTo(top, 3);
    expect(heights[2]).toBeCloseTo(bottom, 3);
    expect(heights[3]).toBeCloseTo(bottom, 3);
  } finally {
    chart.dispose();
  }
});
