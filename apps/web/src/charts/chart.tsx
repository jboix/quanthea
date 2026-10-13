/**
 * The chart component: the only place that draws with ECharts. It draws on a canvas, loads the
 * chart types and maps an option needs, and follows its container's size. A chart draws when it
 * is in the window or about to scroll into it, and every chart draws before the page is printed.
 */
import { type EChartsType, init } from 'echarts/core';
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';
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
 * @param afterResize - Called after each resize, when it holds a function.
 */
function useResizeAndDispose(
  container: RefObject<HTMLDivElement | null>,
  holder: RefObject<Instance | null>,
  afterResize: RefObject<(() => void) | undefined>,
): void {
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      holder.current?.chart.resize();
      afterResize.current?.();
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      holder.current?.chart.dispose();
      holder.current = null;
    };
  }, [container, holder, afterResize]);
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

/**
 * Converts between the first axes of a drawn chart and pixels, for an overlay drawn over the
 * chart, such as a threshold a person drags.
 */
export interface ValueAxis {
  /**
   * The value at a vertical offset.
   *
   * @param y - Pixels from the top of the chart.
   * @returns The value there.
   */
  valueAt(y: number): number;
  /**
   * The vertical offset of a value.
   *
   * @param value - The value.
   * @returns Pixels from the top of the chart.
   */
  yOf(value: number): number;
  /**
   * The horizontal offset of an instant, on a time axis.
   *
   * @param at - The instant, in epoch milliseconds.
   * @returns Pixels from the left of the chart.
   */
  xOf(at: number): number;
}

/** Props of {@link OptionChart}. */
interface OptionChartProps {
  /** The ECharts option, built in this folder. */
  readonly option: Loose;
  /** What the chart shows, for screen readers. */
  readonly label: string;
  /** Called with the value axis each time the chart is drawn or resized. */
  readonly onAxis?: ((axis: ValueAxis) => void) | undefined;
}

/**
 * The value axis of an instance.
 *
 * @param chart - The instance.
 * @returns The converter.
 */
function valueAxisOf(chart: EChartsType): ValueAxis {
  const finder = { yAxisIndex: 0 };
  return {
    valueAt: (y) => Number(chart.convertFromPixel(finder, y)),
    yOf: (value) => Number(chart.convertToPixel(finder, value)),
    xOf: (at) => Number(chart.convertToPixel({ xAxisIndex: 0 }, at)),
  };
}

/**
 * How far outside the window a chart is already drawn, so one about to scroll in is ready.
 */
const drawAhead = '200px';

/**
 * Whether a chart is in the window, or within {@link drawAhead} of it. A browser without
 * `IntersectionObserver` says every chart is.
 *
 * @param container - The chart's container.
 * @returns Whether the chart is to be drawn now.
 */
function useInView(container: RefObject<HTMLDivElement | null>): boolean {
  const [inView, setInView] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const element = container.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => setInView(entries.at(-1)?.isIntersecting ?? false),
      { rootMargin: drawAhead },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [container]);
  return inView;
}

/** Where a chart draws, and what it has drawn. */
interface Drawing {
  /** The container. */
  readonly container: RefObject<HTMLDivElement | null>;
  /** Where the instance is kept. */
  readonly holder: RefObject<Instance | null>;
  /** Called after each draw, when it holds a function. */
  readonly afterDraw: RefObject<(() => void) | undefined>;
  /** The option last drawn, so the same option is not drawn twice. */
  readonly drawn: RefObject<Loose | undefined>;
}

/**
 * Draws an option, once the modules it needs are in.
 *
 * @param drawing - Where to draw.
 * @param option - The option.
 * @param stillWanted - Whether the option is still the one to draw when its modules are in.
 */
function draw(drawing: Drawing, option: Loose, stillWanted: () => boolean): void {
  void loadWhatItNeeds(option).then(() => {
    const element = drawing.container.current;
    if (!stillWanted() || !element) return;
    instanceFor(element, drawing.holder).setOption(option, { notMerge: true });
    drawing.drawn.current = option;
    drawing.afterDraw.current?.();
  });
}

/**
 * Draws the option when the chart is in view and the option is not the one drawn, and before the
 * page is printed wherever the chart is, so a printed page has every chart.
 *
 * @param drawing - Where to draw.
 * @param option - The option.
 * @param inView - Whether the chart is in the window or about to be.
 */
function useDrawn(drawing: Drawing, option: Loose, inView: boolean): void {
  const { container, holder, afterDraw, drawn } = drawing;
  useEffect(() => {
    const parts = { container, holder, afterDraw, drawn };
    let current = true;
    const drawIt = (): void => {
      if (drawn.current !== option) draw(parts, option, () => current);
    };
    if (inView) drawIt();
    window.addEventListener('beforeprint', drawIt);
    return () => {
      current = false;
      window.removeEventListener('beforeprint', drawIt);
    };
  }, [container, holder, afterDraw, drawn, option, inView]);
}

/**
 * Draws an option built in this folder, when the chart is in view. The instance is made once the
 * modules it needs are in.
 *
 * @param props - The option, a label, and who wants the value axis.
 * @returns The chart container.
 */
export function OptionChart({ option, label, onAxis }: OptionChartProps) {
  const container = useRef<HTMLDivElement>(null);
  const holder = useRef<Instance | null>(null);
  const afterDraw = useRef<(() => void) | undefined>(undefined);
  const drawn = useRef<Loose | undefined>(undefined);
  afterDraw.current = () => {
    const chart = holder.current?.chart;
    if (chart && onAxis) onAxis(valueAxisOf(chart));
  };
  useResizeAndDispose(container, holder, afterDraw);
  useDrawn({ container, holder, afterDraw, drawn }, option, useInView(container));
  return <div ref={container} className={styles.chart} role="img" aria-label={label} />;
}
