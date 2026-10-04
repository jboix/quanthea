/**
 * The chart component: the only place that draws with ECharts. It draws on a canvas, loads the
 * chart types and maps an option needs, and follows its container's size.
 */
import { type EChartsType, init } from 'echarts/core';
import { type RefObject, useEffect, useMemo, useRef } from 'react';
import { buildChartOption, type ChartInput } from './build-option.ts';
import styles from './chart.module.css';
import type { Loose } from './loose.ts';
import { ensureMaps } from './maps.ts';
import { ensureModules, modulesGeneration } from './register.ts';
import { useChartTheme } from './theme.ts';

/** Props of {@link Chart}. */
interface ChartProps {
  /** The chart view and its data. */
  readonly input: ChartInput;
  /** The IANA time zone for times, or the browser's. */
  readonly timeZone?: string | undefined;
  /** What the chart shows, for screen readers. */
  readonly label: string;
}

/** An ECharts instance, and which modules were registered when it was made. */
interface Instance {
  /** The instance. */
  readonly chart: EChartsType;
  /** The modules' registration it was made after. */
  readonly generation: number;
}

/**
 * Loads what an option needs before it draws: the chart types and components beyond the common
 * ones, then its map. A map registers only once the geo modules are in, so they load first.
 *
 * @param option - The ECharts option.
 * @returns Once all is loaded.
 */
async function loadWhatItNeeds(option: Parameters<typeof ensureMaps>[0]): Promise<void> {
  await ensureModules(option);
  await ensureMaps(option);
}

/**
 * The instance to draw with: the one there is, or a new one when there is none or it predates the
 * modules registered since.
 *
 * @param element - The container.
 * @param holder - Where the instance is kept.
 * @returns The instance.
 */
function instanceFor(element: HTMLDivElement, holder: RefObject<Instance | null>): EChartsType {
  const kept = holder.current;
  if (kept && kept.generation === modulesGeneration()) return kept.chart;
  kept?.chart.dispose();
  const chart = init(element, undefined, { renderer: 'canvas' });
  holder.current = { chart, generation: modulesGeneration() };
  return chart;
}

/**
 * Follows the container's size, and disposes of the instance when the chart goes.
 *
 * @param container - The container.
 * @param holder - Where the instance is kept.
 */
function useResizeAndDispose(
  container: RefObject<HTMLDivElement | null>,
  holder: RefObject<Instance | null>,
): void {
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => holder.current?.chart.resize());
    observer.observe(element);
    return () => {
      observer.disconnect();
      holder.current?.chart.dispose();
      holder.current = null;
    };
  }, [container, holder]);
}

/**
 * Draws a chart panel's data. The instance is made once the modules the option needs are in.
 *
 * @param props - The view and data, the time zone and a label.
 * @returns The chart container.
 */
export function Chart({ input, timeZone, label }: ChartProps) {
  const theme = useChartTheme();
  const option = useMemo(
    () => buildChartOption(input, { theme, timeZone }),
    [input, theme, timeZone],
  );
  return <OptionChart option={option} label={label} />;
}

/** Props of {@link OptionChart}. */
interface OptionChartProps {
  /** The ECharts option, built in this folder. */
  readonly option: Loose;
  /** What the chart shows, for screen readers. */
  readonly label: string;
}

/**
 * Draws an option built in this folder. The instance is made once the modules it needs are in.
 *
 * @param props - The option and a label.
 * @returns The chart container.
 */
export function OptionChart({ option, label }: OptionChartProps) {
  const container = useRef<HTMLDivElement>(null);
  const holder = useRef<Instance | null>(null);
  useResizeAndDispose(container, holder);
  useEffect(() => {
    let current = true;
    void loadWhatItNeeds(option).then(() => {
      const element = container.current;
      if (current && element) instanceFor(element, holder).setOption(option, { notMerge: true });
    });
    return () => {
      current = false;
    };
  }, [option]);
  return <div ref={container} className={styles.chart} role="img" aria-label={label} />;
}
