import { role } from '../define.ts';
import type { ChartRecipe } from '../recipe.ts';
import { skillScores } from '../samples.ts';

/** A few items scored on the same handful of criteria. */
export const radar: ChartRecipe = {
  id: 'relationship.radar',
  title: 'Radar',
  family: 'relationship',
  whenToUse: ['Two or three items scored on the same 4 to 8 criteria.'],
  whenNotToUse: ['Criteria on different scales, or many items: use comparison.bar.'],
  data: {
    shape: 'long',
    roles: {
      category: role(['string'], 'The criterion: one spoke each.'),
      series: role(['string'], 'The item: one polygon each.', { required: false }),
      value: role(['number'], 'The score.'),
    },
    limits: { maxCategories: 8, maxSeries: 3 },
  },
  render: 'echarts',
  prepare: 'radar',
  option: {
    radar: { radius: '66%', splitNumber: 4, axisName: { color: '@inkSecondary' } },
    series: [{ type: 'radar', areaStyle: { opacity: 0.15 }, symbolSize: 4 }],
    tooltip: { trigger: 'item' },
    legend: {},
  },
  variants: {},
  pitfalls: ['The shape depends on the order of the spokes; areas mislead.'],
  sample: { roles: { category: 'skill', series: 'team', value: 'score' }, datasets: [skillScores] },
  queryHints: ['A score per item and criterion.'],
};
