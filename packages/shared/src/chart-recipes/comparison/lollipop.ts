import { role } from '../define.ts';
import type { ChartRecipe } from '../recipe.ts';
import { regionSales } from '../samples.ts';

/** Ranked categories as dots on thin stems: lighter than bars. */
export const lollipop: ChartRecipe = {
  id: 'comparison.lollipop',
  title: 'Lollipop',
  family: 'comparison',
  whenToUse: ['Many ranked categories where bars would feel heavy.'],
  whenNotToUse: ['Several series per category: use comparison.bar.'],
  data: {
    shape: 'long',
    roles: {
      x: role(['string'], 'The category.'),
      y: role(['number'], 'The value.'),
    },
    limits: { maxCategories: 25 },
  },
  render: 'echarts',
  prepare: 'ranked',
  option: {
    xAxis: { type: 'value', axisLabel: { formatter: '@format' } },
    yAxis: { type: 'category', inverse: true },
    series: [
      {
        type: 'bar',
        barWidth: 2,
        itemStyle: { color: '@palette.0' },
        tooltip: { show: false },
        encode: { x: '@y', y: '@x' },
      },
      {
        type: 'scatter',
        symbolSize: 10,
        itemStyle: { color: '@palette.0' },
        encode: { x: '@y', y: '@x' },
      },
    ],
    tooltip: { trigger: 'item', valueFormatter: '@format' },
  },
  variants: {},
  pitfalls: ['Stems must start at zero, like bars.'],
  sample: { roles: { x: 'region', y: 'sales' }, datasets: [regionSales] },
  queryHints: ['A total per category, largest first.'],
};
