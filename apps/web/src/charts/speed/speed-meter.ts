/**
 * Measures the charts of the chart speed page from inside it: how long they take to draw, and what
 * a tooltip move and a resize cost. The script that drives the page reads the numbers.
 */
import { type EChartsType, getInstanceByDom } from 'echarts/core';

/** How long the page took to draw its charts. */
export interface LoadTimes {
  /** Milliseconds until every chart in view was drawn once. */
  readonly drawnMs: number;
  /** Milliseconds until the page stopped drawing: its animations done, its frames short again. */
  readonly settledMs: number;
  /** The longest the page went without a frame, in milliseconds. */
  readonly longestFrameMs: number;
  /** How many charts were drawn by then. */
  readonly charts: number;
}

/** What the page offers the script that drives it. */
export interface ChartMeter {
  /** Resolves once the page has drawn and settled. */
  readonly loaded: Promise<LoadTimes>;
  /**
   * Moves the tooltip across every drawn chart.
   *
   * @param moves - How many positions per chart.
   * @returns The mean milliseconds of one move, per chart.
   */
  tooltip(moves: number): number[];
  /**
   * Resizes every drawn chart, narrower and back.
   *
   * @returns The mean milliseconds of one resize, per chart.
   */
  resize(): number[];
  /**
   * Counts the charts that are drawn.
   *
   * @returns How many.
   */
  drawn(): number;
}

declare global {
  interface Window {
    /** The meter of the chart speed page, when that page is open. */
    chartSpeed?: ChartMeter;
  }
}

/** A frame shorter than this, in milliseconds, is a frame of a page at rest. */
const calmFrameMs = 34;

/** How many calm frames in a row say the page has settled. */
const calmFrames = 20;

/**
 * The chart containers of the page.
 *
 * @returns The elements charts draw in.
 */
function containers(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-speed-chart] [role="img"]')];
}

/**
 * The charts drawn so far.
 *
 * @returns Their ECharts instances.
 */
function instances(): EChartsType[] {
  return containers().flatMap((element) => getInstanceByDom(element) ?? []);
}

/**
 * How many charts are in the window, at least partly.
 *
 * @returns The count.
 */
function inView(): number {
  return containers().filter((element) => {
    const box = element.getBoundingClientRect();
    return box.bottom > 0 && box.top < window.innerHeight;
  }).length;
}

/** What watching the frames has seen so far. */
interface FrameWatch {
  /** When the page started to render, in the clock of `performance.now()`. */
  readonly start: number;
  /** When the last frame came. */
  last: number;
  /** When every chart in view was first seen drawn. */
  drawnAt?: number;
  /** When the current run of calm frames began. */
  calmSince?: number;
  /** How many calm frames in a row. */
  calm: number;
  /** The longest gap between two frames. */
  longest: number;
}

/**
 * Takes one frame into account.
 *
 * @param watch - What was seen so far, updated in place.
 * @param now - When the frame came.
 * @returns The load times once the page has settled, else `undefined`.
 */
function seeFrame(watch: FrameWatch, now: number): LoadTimes | undefined {
  const gap = now - watch.last;
  watch.last = now;
  watch.longest = Math.max(watch.longest, gap);
  const charts = instances().length;
  if (watch.drawnAt === undefined && charts > 0 && charts >= inView()) watch.drawnAt = now;
  const calm = watch.drawnAt !== undefined && gap < calmFrameMs;
  watch.calm = calm ? watch.calm + 1 : 0;
  if (watch.calm === 1) watch.calmSince = now - gap;
  if (watch.drawnAt === undefined || watch.calm < calmFrames) return undefined;
  return {
    drawnMs: watch.drawnAt - watch.start,
    settledMs: Math.max(watch.drawnAt, watch.calmSince ?? now) - watch.start,
    longestFrameMs: watch.longest,
    charts,
  };
}

/**
 * Watches the frames from the page's first render until it settles.
 *
 * @param start - When the page started to render.
 * @returns The load times.
 */
function watchLoad(start: number): Promise<LoadTimes> {
  const watch: FrameWatch = { start, last: start, calm: 0, longest: 0 };
  return new Promise((resolve) => {
    const frame = (): void => {
      const times = seeFrame(watch, performance.now());
      if (times) resolve(times);
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

/**
 * The mean time of running something a number of times, drawing after each.
 *
 * @param chart - The chart, drawn after each run.
 * @param times - How many runs.
 * @param run - What to run, given the run's number.
 * @returns Milliseconds per run.
 */
function meanCost(chart: EChartsType, times: number, run: (index: number) => void): number {
  const before = performance.now();
  for (let index = 0; index < times; index += 1) {
    run(index);
    chart.getZr().flush();
  }
  return (performance.now() - before) / times;
}

/**
 * What moving the tooltip across a chart costs.
 *
 * @param chart - The chart.
 * @param moves - How many positions, left to right.
 * @returns Milliseconds per move.
 */
function tooltipCost(chart: EChartsType, moves: number): number {
  const [width, y] = [chart.getWidth(), chart.getHeight() / 2];
  const cost = meanCost(chart, moves, (index) =>
    chart.dispatchAction({ type: 'showTip', x: (width * (index + 0.5)) / moves, y }),
  );
  chart.dispatchAction({ type: 'hideTip' });
  return cost;
}

/**
 * What resizing a chart costs: 24 pixels narrower, then back.
 *
 * @param chart - The chart.
 * @returns Milliseconds per resize.
 */
function resizeCost(chart: EChartsType): number {
  const width = chart.getWidth();
  return meanCost(chart, 2, (index) => chart.resize({ width: index === 0 ? width - 24 : width }));
}

/**
 * Starts measuring the page.
 *
 * @param start - When the page started to render, in the clock of `performance.now()`.
 * @returns The meter.
 */
export function createChartMeter(start: number): ChartMeter {
  return {
    loaded: watchLoad(start),
    tooltip: (moves) => instances().map((chart) => tooltipCost(chart, moves)),
    resize: () => instances().map(resizeCost),
    drawn: () => instances().length,
  };
}
