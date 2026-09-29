import { role } from '../define.ts';
import type { ChartRecipe } from '../recipe.ts';
import { revenueWide } from '../samples.ts';

/** Two measures of different scales over time. */
export const dualAxis: ChartRecipe = {
  id: 'trend.dual-axis',
  title: 'Dual axis',
  family: 'trend',
  whenToUse: ['Two measures over time on different scales, such as revenue and orders.'],
  whenNotToUse: ['Measures in the same unit: one axis reads better.', 'More than two measures.'],
  data: {
    shape: 'wide',
    roles: {
      x: role(['time'], 'The time.'),
      left: role(['number'], 'The measure on the left axis, drawn as a line.'),
      right: role(['number'], 'The measure on the right axis, drawn as bars.'),
    },
  },
  render: 'echarts',
  prepare: 'cartesian',
  option: {
    xAxis: { type: 'time' },
    yAxis: [
      { type: 'value', axisLabel: { formatter: '@format' } },
      {
        type: 'value',
        splitLine: { show: false },
        axisLabel: { formatter: { $fmt: 'number', compact: true } },
      },
    ],
    series: [
      { type: 'line', showSymbol: false, yAxisIndex: 0, z: 3, encode: { x: '@x', y: '@left' } },
      {
        type: 'bar',
        yAxisIndex: 1,
        barMaxWidth: 14,
        itemStyle: { opacity: 0.5 },
        encode: { x: '@x', y: '@right' },
      },
    ],
    tooltip: { trigger: 'axis' },
    legend: {},
  },
  variants: {
    lines: {
      title: 'Two lines',
      whenToUse: 'Both measures are levels rather than amounts.',
      patch: { series: [{}, { type: 'line', showSymbol: false, itemStyle: { opacity: 1 } }] },
    },
  },
  pitfalls: ['Two axes invite reading a link between the measures; say what each axis is.'],
  sample: { roles: { x: 'day', left: 'Alpha', right: 'orders' }, datasets: [revenueWide] },
  queryHints: ['Two measures per time bucket, as two columns.'],
};
