import { role } from '../define.ts';
import type { ChartRecipe } from '../recipe.ts';
import { regionSales } from '../samples.ts';

/** A value per category against its target. */
export const bullet: ChartRecipe = {
  id: 'comparison.bullet',
  title: 'Bullet',
  family: 'comparison',
  whenToUse: ['Values against their targets or budgets, per category.'],
  whenNotToUse: ['No target: use comparison.bar.'],
  data: {
    shape: 'wide',
    roles: {
      category: role(['string'], 'The category.'),
      value: role(['number'], 'The actual value, as a bar.'),
      target: role(['number'], 'The target, as a tick.'),
    },
    limits: { maxCategories: 12 },
  },
  render: 'echarts',
  prepare: 'none',
  option: {
    xAxis: { type: 'category' },
    yAxis: { type: 'value', axisLabel: { formatter: '@format' } },
    series: [
      { type: 'bar', barMaxWidth: 24, encode: { x: '@category', y: '@value' } },
      {
        type: 'scatter',
        symbol: 'rect',
        symbolSize: [34, 3],
        z: 3,
        itemStyle: { color: '@ink' },
        encode: { x: '@category', y: '@target' },
      },
    ],
    tooltip: { trigger: 'axis', valueFormatter: '@format' },
    legend: {},
  },
  variants: {
    horizontal: {
      title: 'Horizontal',
      whenToUse: 'Long category names.',
      patch: {
        xAxis: { type: 'value', axisLabel: { formatter: '@format' } },
        yAxis: { type: 'category', axisLabel: null },
        series: [
          { encode: { x: '@value', y: '@category' } },
          { symbolSize: [3, 26], encode: { x: '@target', y: '@category' } },
        ],
      },
    },
  },
  pitfalls: ['Targets in another unit than the values mislead.'],
  sample: {
    roles: { category: 'region', value: 'sales', target: 'target' },
    datasets: [regionSales],
  },
  queryHints: ['The actual value and its target per category, as two columns.'],
};
