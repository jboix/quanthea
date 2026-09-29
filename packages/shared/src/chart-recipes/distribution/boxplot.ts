import { role } from '../define.ts';
import type { ChartRecipe } from '../recipe.ts';
import { latencyValues } from '../samples.ts';

/** The spread of values per group: median, quartiles and range. */
export const boxplot: ChartRecipe = {
  id: 'distribution.boxplot',
  title: 'Box plot',
  family: 'distribution',
  whenToUse: ['Comparing how values spread across groups: latency per endpoint.'],
  whenNotToUse: ['One group: use distribution.histogram, which shows the shape.'],
  data: {
    shape: 'values',
    roles: {
      value: role(['number'], 'The raw values, one per row.'),
      group: role(['string'], 'The group of each value.', { required: false }),
    },
    limits: { maxCategories: 12 },
  },
  render: 'echarts',
  prepare: 'boxplot',
  option: {
    xAxis: { type: 'category' },
    yAxis: { type: 'value', axisLabel: { formatter: '@format' } },
    series: [{ type: 'boxplot', encode: { x: 'group', y: ['min', 'q1', 'median', 'q3', 'max'] } }],
    tooltip: { trigger: 'item' },
  },
  variants: {},
  pitfalls: ['A box of few values says little; show the count in the title or description.'],
  sample: { roles: { value: 'ms', group: 'endpoint' }, datasets: [latencyValues] },
  queryHints: ['The raw values with their group, or a random sample of them.'],
};
