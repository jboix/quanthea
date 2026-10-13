import { describe, expect, test } from 'bun:test';
import type { ChartView, Frame, Panel, QueryOutcome } from '@quanthea/shared';
import { buildChartOption, chartInputOf } from './build-option.ts';
import { type ChartPeriod, chartPeriodOf } from './period-axis.ts';
import { defaultTheme } from './theme.ts';

const hour = 3_600_000;
const to = Date.parse('2026-10-13T11:00:00Z');
/** Seven days, of which the data covers hours of the last day only. */
const week: ChartPeriod = { from: to - 7 * 24 * hour, to };

const lineView: ChartView = {
  kind: 'chart',
  prepare: 'cartesian',
  roles: {},
  option: {
    xAxis: { type: 'time' },
    yAxis: { type: 'value' },
    series: [{ type: 'line', showSymbol: false }],
  },
  datasets: [{ ref: 'A' }],
};

/**
 * A frame of a time and a value.
 *
 * @param rows - Pairs of hours before the end of the week and values.
 * @returns The frame.
 */
function frame(rows: readonly (readonly [number, number | null])[]): Frame {
  return {
    refId: 'A',
    fields: [
      { name: 'time', type: 'time' },
      { name: 'value', type: 'number' },
    ],
    values: [rows.map(([hours]) => to - hours * hour), rows.map(([, value]) => value)],
    meta: { rowCount: rows.length, truncated: false, durationMs: 1 },
  };
}

/**
 * Builds the option of a chart of one query, in UTC.
 *
 * @param rows - Pairs of hours before the end of the week and values.
 * @param period - The time range the panel ran over, if the axis covers it.
 * @param view - The view; a line by default.
 * @returns The option.
 */
function build(
  rows: readonly (readonly [number, number | null])[],
  period?: ChartPeriod,
  view: ChartView = lineView,
) {
  const queries: QueryOutcome[] = [{ refId: 'A', frames: [frame(rows)], error: null }];
  const input = { ...chartInputOf(view, queries, []), period };
  return buildChartOption(input, { theme: defaultTheme, timeZone: 'UTC' }) as {
    xAxis: Record<string, unknown>;
    series: Record<string, unknown>[];
    dataset: { source: unknown[][] }[];
    title?: { text: string };
  };
}

const lastHours = [
  [5, 3],
  [4, 4],
  [3, 5],
] as const;

describe('the time axis of a chart', () => {
  test('runs over the time range the panel ran over, whatever the source returned', () => {
    const { xAxis } = build(lastHours, week);
    expect(xAxis.min).toBe(week.from);
    expect(xAxis.max).toBe(week.to);
    const label = (xAxis.axisLabel as { formatter: (value: number) => string }).formatter;
    // Dates and hours, as a week needs, though the data spans two hours.
    expect(label(week.to)).toBe('13 Oct, 11:00');
  });

  test('is the same for a week and for a day only when they are the same', () => {
    const day = { from: to - 24 * hour, to };
    expect(build(lastHours, day).xAxis.min).not.toBe(build(lastHours, week).xAxis.min);
  });

  test('is left to the data without a time range', () => {
    const { xAxis } = build(lastHours);
    expect(xAxis.min).toBeUndefined();
    expect(xAxis.max).toBeUndefined();
  });

  test('reaches a point outside the time range, such as a first bucket that starts before it', () => {
    const before = week.from - 20 * 60_000;
    const { xAxis } = build([[7 * 24 + 1 / 3, 1], ...lastHours], week);
    expect(xAxis.min).toBe(before);
    expect(xAxis.max).toBe(week.to);
  });

  test('keeps the bounds a view sets itself, and leaves an axis of categories alone', () => {
    const own = { ...lineView, option: { ...lineView.option, xAxis: { type: 'time', min: 5 } } };
    expect(build(lastHours, week, own).xAxis.max).toBeUndefined();
    const bars = {
      ...lineView,
      option: { ...lineView.option, xAxis: { type: 'category' }, series: [{ type: 'bar' }] },
    };
    expect(build(lastHours, week, bars).xAxis.min).toBeUndefined();
  });
});

describe('a stretch with no data', () => {
  test('is a gap in the line: a row of missing values where rows are further than one interval', () => {
    const { dataset, series } = build(
      [
        [9, 1],
        [8, 2],
        [7, 3],
        [3, 4],
        [2, 5],
      ],
      week,
    );
    expect(dataset[0]?.source).toEqual([
      [to - 9 * hour, 1],
      [to - 8 * hour, 2],
      [to - 7 * hour, 3],
      [to - 6 * hour, null],
      [to - 3 * hour, 4],
      [to - 2 * hour, 5],
    ]);
    expect(series[0]?.connectNulls).toBeUndefined();
    expect(series[0]?.showSymbol).toBe(false);
  });

  test('keeps a count of 0 as a point and a missing value as missing', () => {
    const { dataset } = build([
      [3, 0],
      [2, null],
      [1, 2],
    ]);
    expect(dataset[0]?.source.map((row) => row[1])).toEqual([0, null, 2]);
  });

  test('draws a dot on a point no line reaches', () => {
    const { series } = build(
      [
        [9, 1],
        [8, 2],
        [5, 7],
        [2, 4],
        [1, 5],
      ],
      week,
    );
    expect(series[0]?.showSymbol).toBe(true);
    const size = series[0]?.symbolSize as (value: unknown, point: { dataIndex: number }) => number;
    // Rows: 9h, 8h, a hole, 5h, a hole, 2h, 1h.
    expect([0, 1, 2, 3, 4, 5, 6].map((dataIndex) => size(null, { dataIndex }))).toEqual([
      0, 0, 0, 5, 0, 0, 0,
    ]);
  });

  test('adds no bar: bars read the rows the source returned', () => {
    const bars = { ...lineView, option: { ...lineView.option, series: [{ type: 'bar' }] } };
    const { dataset } = build(
      [
        [9, 1],
        [8, 2],
        [2, 4],
      ],
      week,
      bars,
    );
    expect(dataset[0]?.source.map((row) => row[1])).toEqual([1, 2, null, 4]);
  });
});

describe('a chart with no point at all', () => {
  test('says there is no data, without rows and with only missing values', () => {
    expect(build([], week).title?.text).toBe('No data in this range');
    const unknown = build(
      [
        [2, null],
        [1, null],
      ],
      week,
    );
    expect(unknown.title?.text).toBe('No data in this range');
  });

  test('does not say so over a time range of zeros', () => {
    const zeros = build(
      [
        [2, 0],
        [1, 0],
      ],
      week,
    );
    expect(zeros.title).toBeUndefined();
    expect(zeros.xAxis.min).toBe(week.from);
  });
});

describe('chartPeriodOf', () => {
  const inRange = {
    refId: 'A',
    connector: 'pg',
    language: 'sql' as const,
    sql: 'SELECT day, n FROM t WHERE day >= :__from AND day < :__to',
  };
  const fixed = { ...inRange, sql: "SELECT day, n FROM t WHERE day >= '2026-01-01'" };

  /**
   * A panel of one chart.
   *
   * @param queries - Its queries.
   * @param view - Its view.
   * @returns What `chartPeriodOf` reads of it.
   */
  function panel(queries: Panel['queries'], view: Panel['view'] = lineView) {
    return { queries, view };
  }

  test('is the time range of the run when the queries the chart draws follow it', () => {
    expect(chartPeriodOf(panel([inRange]), week)).toEqual(week);
    const other = { ...fixed, refId: 'B' };
    expect(chartPeriodOf(panel([inRange, other]), week)).toEqual(week);
  });

  test('is none for a query that names its own time, which ran over something else', () => {
    expect(chartPeriodOf(panel([fixed]), week)).toBeUndefined();
    const both = { ...lineView, datasets: [{ ref: 'A' }, { ref: 'B' }] };
    expect(chartPeriodOf(panel([inRange, { ...fixed, refId: 'B' }], both), week)).toBeUndefined();
  });

  test('is none when the view asks for an axis cut to its data, or is no chart', () => {
    expect(
      chartPeriodOf(panel([inRange], { ...lineView, timeAxis: 'data' }), week),
    ).toBeUndefined();
    const stat = { kind: 'stat' as const, ref: 'A', reduce: 'last' as const, format: '{value}' };
    expect(chartPeriodOf(panel([inRange], stat), week)).toBeUndefined();
    expect(chartPeriodOf(panel([inRange]), undefined)).toBeUndefined();
  });
});
