import { role } from '../define.ts';
import type { ChartRecipe } from '../recipe.ts';
import { serverMeasures } from '../samples.ts';

/** Items by two measures, to see whether they move together. */
export const scatter: ChartRecipe = {
  id: 'relationship.scatter',
  title: 'Scatter',
  family: 'relationship',
  whenToUse: ['Whether two measures move together: CPU and latency per host.'],
  whenNotToUse: ['One measure over time: use trend.line.'],
  data: {
    shape: 'rows',
    roles: {
      x: role(['number'], 'The measure along the x axis.'),
      y: role(['number'], 'The measure along the y axis.'),
      group: role(['string'], 'What colours the points.', { required: false }),
    },
    limits: { maxSeries: 8 },
  },
  render: 'echarts',
  prepare: 'groups',
  option: {
    xAxis: { type: 'value', scale: true, name: '@x', nameLocation: 'middle', nameGap: 24 },
    yAxis: { type: 'value', scale: true, axisLabel: { formatter: '@format' } },
    series: [{ type: 'scatter', symbolSize: 9, encode: { x: '@x', y: '@y' } }],
    tooltip: { trigger: 'item' },
    legend: {},
  },
  variants: {},
  pitfalls: ['A pattern is not a cause; say what else might explain it.'],
  sample: { roles: { x: 'cpu', y: 'latency', group: 'zone' }, datasets: [serverMeasures] },
  queryHints: ['One row per item with both measures as columns.'],
};
