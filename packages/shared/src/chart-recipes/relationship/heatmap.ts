import { bottomVisualMap, role } from '../define.ts';
import type { ChartRecipe } from '../recipe.ts';
import { weekMatrix } from '../samples.ts';

/** A value for each pair of two categories, as coloured cells. */
export const heatmap: ChartRecipe = {
  id: 'relationship.heatmap',
  title: 'Heatmap',
  family: 'relationship',
  whenToUse: [
    'A value across two dimensions: errors by weekday and hour, traffic by service and region.',
  ],
  whenNotToUse: ['One dimension: use comparison.bar.'],
  data: {
    shape: 'matrix',
    roles: {
      x: role(['string', 'time'], 'The columns of the grid.'),
      y: role(['string'], 'The rows of the grid.'),
      value: role(['number'], 'The value of the cell.'),
    },
    limits: { maxCategories: 40 },
  },
  render: 'echarts',
  prepare: 'matrix',
  option: {
    xAxis: { type: 'category', splitArea: { show: true } },
    yAxis: { type: 'category', splitArea: { show: true } },
    visualMap: { ...bottomVisualMap, dimension: '@value' },
    series: [
      {
        type: 'heatmap',
        encode: { x: '@x', y: '@y', value: '@value' },
        label: { show: true, fontSize: 10 },
        itemStyle: { borderColor: '@surface', borderWidth: 2 },
      },
    ],
    tooltip: { trigger: 'item' },
  },
  variants: {
    plain: {
      title: 'Without numbers',
      whenToUse: 'Many cells, where numbers would crowd.',
      patch: { series: { label: { show: false } } },
    },
  },
  pitfalls: ['Missing cells look like zero; send zeros when a pair had none.'],
  sample: { roles: { x: 'hours', y: 'weekday', value: 'errors' }, datasets: [weekMatrix] },
  queryHints: ['A total per pair of the two columns.'],
};
