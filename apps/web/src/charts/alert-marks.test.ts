import { describe, expect, test } from 'bun:test';
import type { ChartView, Frame, MarkerOutcome, QueryOutcome } from '@quanthea/shared';
import type { AlertMarks } from './alert-marks.ts';
import { buildChartOption, chartInputOf } from './build-option.ts';
import type { Loose } from './loose.ts';
import { defaultTheme } from './theme.ts';

const t0 = Date.parse('2026-09-26T12:00:00Z');

/** The error share of one service, a point a minute. */
const frame: Frame = {
  refId: 'A',
  fields: [
    { name: 'Time', type: 'time' },
    { name: 'Value', type: 'number', labels: { service: 'payments' } },
  ],
  values: [
    [t0, t0 + 60_000, t0 + 120_000],
    [0.01, 0.0231, 0.04],
  ],
  meta: { rowCount: 3, truncated: false, durationMs: 1 },
};

/** A deploy marker. */
const deploy: MarkerOutcome = {
  annotation: 'deploys',
  label: 'deploy',
  color: '@ink',
  points: [{ time: t0 + 60_000, text: 'deploy #481' }],
  error: null,
};

/** A threshold at 2.31% and one firing period. */
const marks: AlertMarks = {
  thresholds: [{ value: 0.0231, label: '2.31%' }],
  periods: [{ from: t0 + 60_000, to: t0 + 120_000 }],
};

/**
 * The first series of a chart's option.
 *
 * @param xType - The x axis type.
 * @param markers - The markers.
 * @param alertMarks - The alerts' marks.
 * @returns The series.
 */
function firstSeries(
  xType: 'time' | 'category',
  markers: MarkerOutcome[],
  alertMarks: AlertMarks | undefined,
): Loose {
  const view: ChartView = {
    kind: 'chart',
    prepare: 'cartesian',
    roles: {},
    option: { xAxis: { type: xType }, yAxis: { type: 'value' }, series: [{ type: 'line' }] },
    datasets: [{ ref: 'A' }],
  };
  const queries: QueryOutcome[] = [{ refId: 'A', frames: [frame], error: null }];
  const input = chartInputOf(view, queries, markers, [], alertMarks);
  const option = buildChartOption(input, { theme: defaultTheme, timeZone: 'UTC' });
  return (option.series as Loose[])[0] ?? {};
}

describe('the marks of linked alerts', () => {
  test('draw each threshold as an exact dashed line in the danger colour', () => {
    const series = firstSeries('time', [], marks);
    const markLine = series.markLine as Loose;
    expect(markLine.precision).toBe(-1);
    expect(markLine.data).toEqual([
      expect.objectContaining({
        yAxis: 0.0231,
        lineStyle: { color: defaultTheme.danger, type: 'dashed', width: 1.5 },
      }),
    ]);
  });

  test('shade the firing periods in the danger colour', () => {
    const series = firstSeries('time', [], marks);
    expect((series.markArea as Loose).data).toEqual([
      [
        { xAxis: t0 + 60_000, itemStyle: { color: defaultTheme.danger, opacity: 0.1 } },
        { xAxis: t0 + 120_000 },
      ],
    ]);
  });

  test('join the annotation markers, which keep their lines', () => {
    const data = (firstSeries('time', [deploy], marks).markLine as Loose).data as Loose[];
    expect(data.map((each) => each.xAxis ?? each.yAxis)).toEqual([t0 + 60_000, 0.0231]);
  });

  test('go only on time charts, and nothing without alerts', () => {
    expect(firstSeries('category', [], marks).markLine).toBeUndefined();
    const series = firstSeries('time', [], undefined);
    expect(series.markLine).toBeUndefined();
    expect(series.markArea).toBeUndefined();
  });
});
