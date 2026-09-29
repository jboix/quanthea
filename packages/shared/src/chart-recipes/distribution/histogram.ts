import { role } from '../define.ts';
import type { ChartRecipe } from '../recipe.ts';
import { latencyValues } from '../samples.ts';

/** How raw values spread, in equal-width bins. */
export const histogram: ChartRecipe = {
  id: 'distribution.histogram',
  title: 'Histogram',
  family: 'distribution',
  whenToUse: ['How individual values spread: response times, order sizes.'],
  whenNotToUse: [
    'Values already counted per bucket: use comparison.bar.',
    'Comparing spreads of several groups: use distribution.boxplot.',
  ],
  data: {
    shape: 'values',
    roles: { value: role(['number'], 'The raw values, one per row.') },
  },
  render: 'echarts',
  prepare: 'bins',
  option: {
    xAxis: { type: 'category' },
    yAxis: { type: 'value', axisLabel: { formatter: { $fmt: 'number', compact: true } } },
    series: [{ type: 'bar', barCategoryGap: '4%', encode: { x: 'bin', y: 'count' } }],
    tooltip: { trigger: 'axis' },
  },
  variants: {},
  pitfalls: [
    'The data is cut to the row limit; a sample of raw values reads the same shape.',
    'Heavy tails flatten the rest: filter out rare extremes or say they are there.',
  ],
  sample: { roles: { value: 'ms' }, datasets: [latencyValues] },
  queryHints: ['The raw values, or a random sample of them.'],
};
