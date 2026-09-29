/**
 * The chart component: the only place that draws with ECharts. It draws on a canvas, loads the
 * maps an option needs, and follows its container's size.
 */
import { type EChartsType, init } from 'echarts/core';
import { useEffect, useMemo, useRef } from 'react';
import { buildChartOption, type ChartInput } from './build-option.ts';
import styles from './chart.module.css';
import { ensureMaps } from './maps.ts';
import './register.ts';
import { readTheme } from './theme.ts';

/** Props of {@link Chart}. */
interface ChartProps {
  /** The chart view and its data. */
  readonly input: ChartInput;
  /** The IANA time zone for times, or the browser's. */
  readonly timeZone?: string | undefined;
  /** What the chart shows, for screen readers. */
  readonly label: string;
}

/**
 * Draws a chart panel's data.
 *
 * @param props - The view and data, the time zone and a label.
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
    let current = true;
    void ensureMaps(option).then(() => {
      if (current) chart.current?.setOption(option, { notMerge: true });
    });
    return () => {
      current = false;
    };
  }, [option]);
  return <div ref={container} className={styles.chart} role="img" aria-label={label} />;
}
