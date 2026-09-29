import { role, zoomPatch } from '../define.ts';
import type { ChartRecipe } from '../recipe.ts';
import { trafficLong } from '../samples.ts';

/** A number over time. */
export const line: ChartRecipe = {
  id: 'trend.line',
  title: 'Line',
  family: 'trend',
  whenToUse: [
    'A number over time: rates, counts, latencies per time bucket.',
    'One series, or a few to compare.',
  ],
  whenNotToUse: [
    'Categories with no order: use comparison.bar.',
    'More than 8 series: use layout.small-multiples or keep the top ones.',
  ],
  data: {
    shape: 'long',
    accepts: ['wide'],
    roles: {
      x: role(['time'], 'The time.'),
      series: role(['string'], 'What splits the lines, in a long table.', { required: false }),
      y: role(['number'], 'The values: one column, or one per series in a wide table.', {
        multiple: true,
      }),
    },
    limits: { maxSeries: 8 },
  },
  render: 'echarts',
  prepare: 'cartesian',
  option: {
    xAxis: { type: 'time' },
    yAxis: { type: 'value', axisLabel: { formatter: '@format' } },
    series: [{ type: 'line', showSymbol: false, encode: { x: '@x', y: '@y' } }],
    tooltip: { trigger: 'axis', valueFormatter: '@format' },
    legend: {},
  },
  variants: {
    area: {
      title: 'Area',
      whenToUse: 'The volume under the line matters.',
      patch: { series: { areaStyle: { opacity: 0.15 } } },
    },
    stacked: {
      title: 'Stacked area',
      whenToUse: 'Series are parts of a total.',
      patch: { series: { stack: 'total', areaStyle: { opacity: 0.45 } } },
    },
    step: {
      title: 'Step',
      whenToUse: 'Values change in steps, such as replicas or a setting.',
      patch: { series: { step: 'end' } },
    },
    smooth: {
      title: 'Smoothed',
      whenToUse: 'A noisy trend where the shape matters more than each point.',
      patch: { series: { smooth: true } },
    },
    points: {
      title: 'With points',
      whenToUse: 'Few points, each worth seeing.',
      patch: { series: { showSymbol: true, symbolSize: 5 } },
    },
    zoom: {
      title: 'Zoomable',
      whenToUse: 'A long range people will look into.',
      patch: zoomPatch,
    },
  },
  pitfalls: [
    'More than 8 lines cannot be told apart.',
    'A counter drawn raw only goes up: draw its rate.',
    'Stacking series that are not parts of a total misleads.',
  ],
  sample: { roles: { x: 'time', series: 'service', y: 'requests' }, datasets: [trafficLong] },
  queryHints: ['A value per time bucket, with a column or label naming each series.'],
};
