import { role } from '../define.ts';
import type { ChartRecipe } from '../recipe.ts';
import { dailyCounts } from '../samples.ts';

/** The latest value, big, over a sparkline of the range. */
export const bigNumber: ChartRecipe = {
  id: 'kpi.big-number',
  title: 'Big number with sparkline',
  family: 'kpi',
  whenToUse: ['A headline number and whether it is going up or down.'],
  whenNotToUse: ['When the exact trend matters: use trend.line.'],
  data: {
    shape: 'wide',
    roles: {
      x: role(['time'], 'The time.'),
      value: role(['number'], 'The value; the last one is the big number.'),
    },
  },
  render: 'echarts',
  prepare: 'kpi',
  option: {
    title: {
      text: '@last',
      format: '@format',
      left: 0,
      top: 0,
      textStyle: { fontSize: 28, fontWeight: 600, color: '@ink' },
    },
    xAxis: { type: 'time', show: false },
    yAxis: { type: 'value', show: false, scale: true },
    series: [
      {
        type: 'line',
        showSymbol: false,
        lineStyle: { width: 1.5 },
        areaStyle: { opacity: 0.12 },
        encode: { x: '@x', y: '@value' },
      },
    ],
    tooltip: { trigger: 'axis', valueFormatter: '@format' },
  },
  variants: {},
  pitfalls: ['The last bucket may be partial and look like a drop.'],
  sample: { roles: { x: 'day', value: 'signups' }, datasets: [dailyCounts] },
  queryHints: ['A value per time bucket over the range.'],
};
