import { role } from '../define.ts';
import type { ChartRecipe } from '../recipe.ts';
import { trafficLong } from '../samples.ts';

/** One small chart per series, sharing the axes. */
export const smallMultiples: ChartRecipe = {
  id: 'layout.small-multiples',
  title: 'Small multiples',
  family: 'layout',
  whenToUse: [
    'Many series whose shapes matter: one small chart each, same scale.',
    'Comparing the trend of each service, region or host.',
  ],
  whenNotToUse: ['Two or three series: one chart reads faster.', 'More than 9 series.'],
  data: {
    shape: 'long',
    roles: {
      facet: role(['string'], 'What gets its own chart.'),
      x: role(['time', 'string'], 'The x of each chart.'),
      y: role(['number'], 'The value.'),
    },
    limits: { maxSeries: 9 },
  },
  render: 'echarts',
  prepare: 'facets',
  option: {
    xAxis: { type: 'time', axisLabel: { hideOverlap: true } },
    yAxis: { type: 'value', axisLabel: { formatter: '@format' }, splitNumber: 2 },
    series: [
      {
        type: 'line',
        showSymbol: false,
        areaStyle: { opacity: 0.1 },
        encode: { x: '@x', y: '@y' },
      },
    ],
    tooltip: { trigger: 'axis', valueFormatter: '@format' },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
  },
  variants: {
    bars: {
      title: 'Bars',
      whenToUse: 'Each small chart compares categories.',
      patch: { xAxis: { type: 'category' }, series: { type: 'bar', areaStyle: null } },
    },
  },
  pitfalls: ['Every chart shares the y scale; a series much larger than the rest flattens them.'],
  sample: { roles: { facet: 'service', x: 'time', y: 'requests' }, datasets: [trafficLong] },
  queryHints: ['A value per x and facet, in one long table.'],
};
