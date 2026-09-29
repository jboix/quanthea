import { role } from '../define.ts';
import type { ChartRecipe } from '../recipe.ts';
import { regionSales } from '../samples.ts';

/** Categories ranked by value, largest first, as horizontal bars. */
export const rankedBar: ChartRecipe = {
  id: 'comparison.ranked-bar',
  title: 'Ranked bars',
  family: 'comparison',
  whenToUse: ['The top or bottom categories by one value: top endpoints, largest customers.'],
  whenNotToUse: ['Categories with an order of their own, such as months: use comparison.bar.'],
  data: {
    shape: 'long',
    roles: {
      x: role(['string'], 'The category.'),
      y: role(['number'], 'The value ranked by.'),
    },
    limits: { maxCategories: 15 },
  },
  render: 'echarts',
  prepare: 'ranked',
  option: {
    xAxis: { type: 'value', axisLabel: { formatter: '@format' } },
    yAxis: { type: 'category', inverse: true },
    series: [
      {
        type: 'bar',
        barMaxWidth: 22,
        encode: { x: '@y', y: '@x' },
        label: { show: true, position: 'right', formatter: '@format' },
      },
    ],
    tooltip: { trigger: 'axis', valueFormatter: '@format' },
  },
  variants: {},
  pitfalls: ['Categories past the limit are left out; say so in the title, such as "Top 15".'],
  sample: { roles: { x: 'region', y: 'sales' }, datasets: [regionSales] },
  queryHints: ['A total per category, largest first, cut to the top N.'],
};
