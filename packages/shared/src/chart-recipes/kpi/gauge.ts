import { role } from '../define.ts';
import type { ChartRecipe } from '../recipe.ts';
import { diskUse } from '../samples.ts';

/** One value as progress towards a maximum. */
export const gauge: ChartRecipe = {
  id: 'kpi.gauge',
  title: 'Gauge',
  family: 'kpi',
  whenToUse: ['One value with a known maximum: disk used, quota spent, SLO budget left.'],
  whenNotToUse: ['No natural maximum: use kpi.stat.'],
  data: {
    shape: 'single',
    accepts: ['long', 'wide'],
    roles: { value: role(['number'], 'The value; the last row is shown.') },
  },
  render: 'echarts',
  prepare: 'gauge',
  option: {
    series: [
      {
        type: 'gauge',
        min: 0,
        max: 1,
        startAngle: 220,
        endAngle: -40,
        progress: { show: true, width: 12, roundCap: true },
        axisLine: { roundCap: true, lineStyle: { width: 12, color: [[1, '@divider']] } },
        pointer: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        title: { show: false },
        detail: {
          formatter: '@format',
          fontSize: 24,
          fontWeight: 600,
          offsetCenter: [0, 0],
          color: '@ink',
        },
      },
    ],
  },
  variants: {
    dial: {
      title: 'Dial',
      whenToUse: 'A needle reads better, such as for speed or load.',
      patch: {
        series: {
          progress: { show: false },
          pointer: { show: true, width: 4, length: '60%' },
          axisTick: { show: true, distance: -12, length: 4 },
          axisLabel: { show: true, distance: 18, formatter: '@format', fontSize: 10 },
          detail: { offsetCenter: [0, '40%'], fontSize: 18 },
        },
      },
    },
  },
  pitfalls: ['Set max to the real maximum; the sample uses 1 for a ratio.'],
  sample: { roles: { value: 'used' }, datasets: [diskUse] },
  queryHints: ['One current value, as a ratio of its maximum or with the maximum known.'],
};
