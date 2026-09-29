import { role } from '../define.ts';
import type { ChartRecipe } from '../recipe.ts';
import { serverMeasures } from '../samples.ts';

/** Items across several measures, one line each. */
export const parallel: ChartRecipe = {
  id: 'relationship.parallel',
  title: 'Parallel coordinates',
  family: 'relationship',
  whenToUse: ['Comparing items across four or more measures, to spot groups and outliers.'],
  whenNotToUse: ['Two or three measures: use relationship.scatter or relationship.bubble.'],
  data: {
    shape: 'rows',
    roles: {
      dimensions: role(['number'], 'The measures, one axis each.', { multiple: true }),
      group: role(['string'], 'What colours the lines.', { required: false }),
    },
    limits: { maxSeries: 6 },
  },
  render: 'echarts',
  prepare: 'parallel',
  option: {
    parallel: { left: 40, right: 48, top: 36, bottom: 24 },
    series: [{ type: 'parallel', lineStyle: { width: 1, opacity: 0.55 } }],
    legend: {},
  },
  variants: {},
  pitfalls: ['Axis order changes what patterns show; put related measures side by side.'],
  sample: {
    roles: { dimensions: ['cpu', 'latency', 'errors', 'requests'], group: 'zone' },
    datasets: [serverMeasures],
  },
  queryHints: ['One row per item with each measure as a column.'],
};
