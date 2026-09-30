/**
 * The ECharts modules charts use. Only what is registered ships: the common charts and the
 * components every chart may use load with the chart module; the other chart types and the
 * components only they use load the first time a chart needs them.
 */
import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts';
import {
  AxisPointerComponent,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { isObject, type Loose } from './loose.ts';

use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  AxisPointerComponent,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  TitleComponent,
  TooltipComponent,
  CanvasRenderer,
]);

/** The series types registered with the chart module. */
const commonSeries = new Set(['line', 'bar', 'pie', 'scatter']);

/** The option keys of components that only the other chart types use. */
const otherComponents = ['calendar', 'dataZoom', 'geo', 'parallel', 'radar', 'visualMap'];

/**
 * Whether an option needs a chart type or component beyond the common ones.
 *
 * @param option - The ECharts option.
 * @returns Whether it does.
 */
export function needsOtherModules(option: Loose): boolean {
  const series = [option.series ?? []].flat().filter(isObject);
  const types = series.map((each) => each.type);
  const otherSeries = types.some((type) => typeof type === 'string' && !commonSeries.has(type));
  return otherSeries || otherComponents.some((key) => option[key] !== undefined);
}

/** The other modules, once asked for. */
let others: Promise<unknown> | undefined;

/** How many times modules were registered after the chart module: 0, then 1. */
let generation = 0;

/**
 * Which modules are registered. An ECharts instance keeps the layouts and visuals registered
 * when it was created, so an instance older than the latest registration must be made again.
 *
 * @returns The registration's number.
 */
export function modulesGeneration(): number {
  return generation;
}

/**
 * Registers the other chart types and components, when an option needs them.
 *
 * @param option - The ECharts option.
 * @returns Once they are registered.
 */
export async function ensureModules(option: Loose): Promise<void> {
  if (!needsOtherModules(option)) return;
  others ??= import('./register-others.ts').then(() => {
    generation = 1;
  });
  await others;
}
