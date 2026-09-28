/**
 * The chart component: the only place that touches ECharts. It registers just the chart types
 * and components the spec allows, draws on a canvas, and follows its container's size.
 */
import {
  BarChart,
  GaugeChart,
  HeatmapChart,
  LineChart,
  PieChart,
  ScatterChart,
} from 'echarts/charts';
import {
  DatasetComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import { type EChartsType, init, use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useMemo, useRef } from 'react';
import { buildChartOption, type ChartInput } from './build-option.ts';
import styles from './chart.module.css';
import { readTheme } from './theme.ts';

use([
  BarChart,
  GaugeChart,
  HeatmapChart,
  LineChart,
  PieChart,
  ScatterChart,
  DatasetComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

/** Props of {@link Chart}. */
interface ChartProps {
  /** The chart view and its results. */
  readonly input: ChartInput;
  /** The IANA time zone for times, or the browser's. */
  readonly timeZone?: string | undefined;
  /** What the chart shows, for screen readers. */
  readonly label: string;
}

/**
 * Draws a chart panel's results.
 *
 * @param props - The view and results, the time zone and a label.
 * @returns The chart container.
 */
export function Chart({ input, timeZone, label }: ChartProps) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);
  const option = useMemo(
    () => buildChartOption(input, { theme: readTheme(document.documentElement), timeZone }),
    [input, timeZone],
  );
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const instance = init(element, undefined, { renderer: 'canvas' });
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(element);
    chart.current = instance;
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);
  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);
  return <div ref={container} className={styles.chart} role="img" aria-label={label} />;
}
