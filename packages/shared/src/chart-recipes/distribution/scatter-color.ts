import { bottomVisualMap, role } from '../define.ts';
import type { ChartRecipe } from '../recipe.ts';
import { serverMeasures } from '../samples.ts';

/** Points by two measures, coloured by a third. */
export const scatterColor: ChartRecipe = {
  id: 'distribution.scatter-color',
  title: 'Scatter with colour',
  family: 'distribution',
  whenToUse: [
    'How items spread over two measures, with a third as colour: hosts by CPU, latency and errors.',
  ],
  whenNotToUse: ['A third measure people must read exactly: use relationship.bubble or a table.'],
  data: {
    shape: 'rows',
    roles: {
      x: role(['number'], 'The measure along the x axis.'),
      y: role(['number'], 'The measure along the y axis.'),
      color: role(['number'], 'The measure the colour shows.'),
    },
  },
  render: 'echarts',
  prepare: 'none',
  option: {
    xAxis: { type: 'value', scale: true, name: '@x', nameLocation: 'middle', nameGap: 24 },
    yAxis: { type: 'value', scale: true, axisLabel: { formatter: '@format' } },
    series: [{ type: 'scatter', symbolSize: 10, encode: { x: '@x', y: '@y' } }],
    visualMap: { ...bottomVisualMap, dimension: '@color' },
    tooltip: { trigger: 'item' },
  },
  variants: {},
  pitfalls: ['Colour is read roughly; keep exact comparisons on the axes.'],
  sample: { roles: { x: 'cpu', y: 'latency', color: 'errors' }, datasets: [serverMeasures] },
  queryHints: ['One row per item with its measures as columns.'],
};
