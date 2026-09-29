import { role, zoomPatch } from '../define.ts';
import type { ChartRecipe } from '../recipe.ts';
import { pricesOhlc } from '../samples.ts';

/** Open, close, low and high per period. */
export const candlestick: ChartRecipe = {
  id: 'trend.candlestick',
  title: 'Candlestick',
  family: 'trend',
  whenToUse: ['A price or level per period with its open, close, low and high.'],
  whenNotToUse: ['One value per period: use trend.line.'],
  data: {
    shape: 'ohlc',
    roles: {
      x: role(['time'], 'The period.'),
      open: role(['number'], 'The first value of the period.'),
      close: role(['number'], 'The last value of the period.'),
      low: role(['number'], 'The lowest value.'),
      high: role(['number'], 'The highest value.'),
    },
  },
  render: 'echarts',
  prepare: 'none',
  option: {
    xAxis: { type: 'time' },
    yAxis: { type: 'value', scale: true, axisLabel: { formatter: '@format' } },
    series: [
      {
        type: 'candlestick',
        barMaxWidth: 12,
        encode: { x: '@x', y: ['@open', '@close', '@low', '@high'] },
      },
    ],
    tooltip: { trigger: 'axis' },
  },
  variants: {
    zoom: { title: 'Zoomable', whenToUse: 'Many periods.', patch: zoomPatch },
  },
  pitfalls: ['Periods must be even; gaps read as flat days.'],
  sample: {
    roles: { x: 'day', open: 'open', close: 'close', low: 'low', high: 'high' },
    datasets: [pricesOhlc],
  },
  queryHints: ['The first, last, lowest and highest value per time bucket.'],
};
