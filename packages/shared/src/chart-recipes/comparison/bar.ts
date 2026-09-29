import { role } from '../define.ts';
import type { ChartRecipe } from '../recipe.ts';
import { channelSales } from '../samples.ts';

/** Values by category, one bar per category and series. */
export const bar: ChartRecipe = {
  id: 'comparison.bar',
  title: 'Bar',
  family: 'comparison',
  whenToUse: [
    'Comparing values across categories.',
    'Several series per category: grouped, stacked or as shares of 100%.',
  ],
  whenNotToUse: [
    'Values over time with many points: use trend.line.',
    'More than 20 categories: use comparison.ranked-bar with a limit.',
  ],
  data: {
    shape: 'long',
    accepts: ['wide'],
    roles: {
      x: role(['string', 'time'], 'The category.'),
      series: role(['string'], 'What splits the bars, in a long table.', { required: false }),
      y: role(['number'], 'The values.', { multiple: true }),
    },
    limits: { maxCategories: 20, maxSeries: 6 },
  },
  render: 'echarts',
  prepare: 'cartesian',
  option: {
    xAxis: { type: 'category' },
    yAxis: { type: 'value', axisLabel: { formatter: '@format' } },
    series: [{ type: 'bar', barMaxWidth: 32, encode: { x: '@x', y: '@y' } }],
    tooltip: { trigger: 'axis', valueFormatter: '@format' },
    legend: {},
  },
  variants: {
    stacked: {
      title: 'Stacked',
      whenToUse: 'Series are parts of each category’s total.',
      patch: { series: { stack: 'total' } },
    },
    percent: {
      title: '100% stacked',
      whenToUse: 'The mix within each category matters more than its total.',
      prepare: 'shares',
      patch: {
        series: { stack: 'total' },
        yAxis: { max: 1, axisLabel: { formatter: { $fmt: 'percent', decimals: 0 } } },
        tooltip: { valueFormatter: { $fmt: 'percent', decimals: 1 } },
      },
    },
    horizontal: {
      title: 'Horizontal',
      whenToUse: 'Long category names.',
      patch: {
        xAxis: { type: 'value', axisLabel: { formatter: '@format' } },
        yAxis: { type: 'category', axisLabel: null },
        series: { encode: { x: '@y', y: '@x' } },
      },
    },
    labels: {
      title: 'With values',
      whenToUse: 'Few bars whose exact values matter.',
      patch: { series: { label: { show: true, position: 'top', formatter: '@format' } } },
    },
  },
  pitfalls: [
    'Bars must start at zero; never set the value axis minimum above it.',
    'Stacked bars hide how each series changes except the first.',
  ],
  sample: { roles: { x: 'region', series: 'channel', y: 'sales' }, datasets: [channelSales] },
  queryHints: ['A total per category, and optionally per a second column that splits it.'],
};
