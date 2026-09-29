import { role } from '../define.ts';
import type { ChartRecipe } from '../recipe.ts';
import { regionSales } from '../samples.ts';

/** Shares of a whole. */
export const pie: ChartRecipe = {
  id: 'composition.pie',
  title: 'Pie',
  family: 'composition',
  whenToUse: ['Shares of one total with few parts, where one or two dominate.'],
  whenNotToUse: [
    'More than 6 parts, or parts of similar size: use comparison.ranked-bar.',
    'Values that do not add up to a whole.',
  ],
  data: {
    shape: 'long',
    roles: {
      category: role(['string'], 'The part.'),
      value: role(['number'], 'Its size.'),
    },
    limits: { maxCategories: 6 },
  },
  render: 'echarts',
  prepare: 'items',
  option: {
    series: [
      {
        type: 'pie',
        radius: ['0%', '70%'],
        label: { formatter: '{b}' },
        encode: { itemName: '@category', value: '@value' },
      },
    ],
    tooltip: { trigger: 'item', valueFormatter: '@format' },
  },
  variants: {
    donut: {
      title: 'Donut',
      whenToUse: 'The same, lighter; leaves room for a total in the middle.',
      patch: { series: { radius: ['45%', '70%'] } },
    },
    rose: {
      title: 'Rose',
      whenToUse: 'Rarely: only when the radius, not the angle, should carry the value.',
      patch: { series: { roseType: 'radius', radius: ['12%', '75%'] } },
    },
  },
  pitfalls: [
    'Parts past the limit are summed into "Other".',
    'Angles are hard to compare; a ranked bar is usually clearer.',
  ],
  sample: { roles: { category: 'region', value: 'sales' }, datasets: [regionSales] },
  queryHints: ['A total per part.'],
};
