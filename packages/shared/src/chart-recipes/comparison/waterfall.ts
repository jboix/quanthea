import { role } from '../define.ts';
import type { ChartRecipe } from '../recipe.ts';
import { budgetChanges } from '../samples.ts';

/** How a starting total changes step by step to an ending total. */
export const waterfall: ChartRecipe = {
  id: 'comparison.waterfall',
  title: 'Waterfall',
  family: 'comparison',
  whenToUse: ['How a total moves from start to end through gains and losses.'],
  whenNotToUse: ['Changes that do not add up to one total.'],
  data: {
    shape: 'long',
    roles: {
      category: role(['string'], 'The step; the first row is the starting total.'),
      change: role(['number'], 'The change of the step; the first row holds the start.'),
    },
    limits: { maxCategories: 15 },
  },
  render: 'echarts',
  prepare: 'waterfall',
  option: {
    xAxis: { type: 'category' },
    yAxis: { type: 'value', axisLabel: { formatter: '@format' } },
    series: [
      {
        type: 'bar',
        name: 'base',
        stack: 'walk',
        silent: true,
        itemStyle: { color: 'transparent' },
        tooltip: { show: false },
        encode: { x: 'category', y: 'base' },
      },
      {
        type: 'bar',
        name: 'Increase',
        stack: 'walk',
        itemStyle: { color: '@palette.0' },
        encode: { x: 'category', y: 'up' },
      },
      {
        type: 'bar',
        name: 'Decrease',
        stack: 'walk',
        itemStyle: { color: '@palette.1' },
        encode: { x: 'category', y: 'down' },
      },
    ],
    tooltip: { trigger: 'axis', valueFormatter: '@format' },
  },
  variants: {},
  pitfalls: ['The last bar is the running total the adapter adds; do not send it as a row.'],
  sample: { roles: { category: 'step', change: 'change' }, datasets: [budgetChanges] },
  queryHints: ['The starting total, then one change per step, in order.'],
};
