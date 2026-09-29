import { role } from '../define.ts';
import type { ChartRecipe } from '../recipe.ts';
import { dailyCounts } from '../samples.ts';

/** A tiny line with no axes. */
export const sparkline: ChartRecipe = {
  id: 'trend.sparkline',
  title: 'Sparkline',
  family: 'trend',
  whenToUse: ['The shape of a trend in a small panel, next to other small panels.'],
  whenNotToUse: ['When people need to read values: use trend.line.'],
  data: {
    shape: 'wide',
    roles: { x: role(['time'], 'The time.'), y: role(['number'], 'The value.') },
  },
  render: 'echarts',
  prepare: 'cartesian',
  option: {
    xAxis: { type: 'time', show: false },
    yAxis: { type: 'value', show: false, scale: true },
    series: [
      {
        type: 'line',
        showSymbol: false,
        lineStyle: { width: 1.5 },
        areaStyle: { opacity: 0.12 },
        encode: { x: '@x', y: '@y' },
      },
    ],
    tooltip: { trigger: 'axis', valueFormatter: '@format' },
  },
  variants: {},
  pitfalls: ['No axis means no scale: pair it with the number it shows.'],
  sample: { roles: { x: 'day', y: 'signups' }, datasets: [dailyCounts] },
  queryHints: ['A value per time bucket.'],
};
