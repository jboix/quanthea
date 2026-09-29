import { role } from '../define.ts';
import type { ChartRecipe } from '../recipe.ts';
import { serverMeasures } from '../samples.ts';

/** A scatter whose point sizes show a third measure. */
export const bubble: ChartRecipe = {
  id: 'relationship.bubble',
  title: 'Bubble',
  family: 'relationship',
  whenToUse: ['Two measures and a third that weighs each item, such as traffic.'],
  whenNotToUse: ['Many overlapping items: bubbles hide each other.'],
  data: {
    shape: 'rows',
    roles: {
      x: role(['number'], 'The measure along the x axis.'),
      y: role(['number'], 'The measure along the y axis.'),
      size: role(['number'], 'The measure the size shows.'),
      group: role(['string'], 'What colours the bubbles.', { required: false }),
    },
    limits: { maxSeries: 8 },
  },
  render: 'echarts',
  prepare: 'groups',
  option: {
    xAxis: { type: 'value', scale: true, name: '@x', nameLocation: 'middle', nameGap: 24 },
    yAxis: { type: 'value', scale: true, axisLabel: { formatter: '@format' } },
    series: [{ type: 'scatter', itemStyle: { opacity: 0.7 }, encode: { x: '@x', y: '@y' } }],
    visualMap: { show: false, dimension: '@size', inRange: { symbolSize: [6, 34] } },
    tooltip: { trigger: 'item' },
    legend: {},
  },
  variants: {},
  pitfalls: ['Sizes are read by area and roughly; keep the key comparison on an axis.'],
  sample: {
    roles: { x: 'cpu', y: 'latency', size: 'requests', group: 'zone' },
    datasets: [serverMeasures],
  },
  queryHints: ['One row per item with its three measures as columns.'],
};
