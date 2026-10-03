/**
 * What a chart draws, without ECharts: panels build their chart input from here and load the
 * chart itself lazily from `index.ts`.
 */
export { type ChartHighlight, chartInputOf } from './build-option.ts';
