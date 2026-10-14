/**
 * Selecting a stretch of a time chart with the pointer, to narrow the dashboard's time range to
 * it. The dashboard provides what a selection does; a chart outside a dashboard selects nothing.
 */
import type { EChartsType } from 'echarts/core';
import { createContext, type PointerEvent, useContext, useState } from 'react';
import type { Loose } from './loose.ts';

/** What a selected stretch does: called with its start and end, in epoch milliseconds. */
export type RangeSelected = (from: number, to: number) => void;

/** What a selection does on the dashboard around a chart, if anything. */
export const RangeSelectContext = createContext<RangeSelected | undefined>(undefined);

/** The narrowest drag, in pixels, that selects a stretch; a narrower one is a click. */
const minimumWidth = 8;

/**
 * Whether an option draws over time and lets the pointer select: a time x axis, and no zoom of
 * its own, which takes the same drag.
 *
 * @param option - The ECharts option.
 * @returns Whether a stretch can be selected on it.
 */
export function selectsTime(option: Loose): boolean {
  const axes = [option.xAxis ?? []].flat() as readonly { type?: unknown }[];
  const zooms = [option.dataZoom ?? []].flat();
  return axes[0]?.type === 'time' && zooms.length === 0;
}

/**
 * The stretch a drag selects, earliest first, or nothing for a drag too narrow to mean one.
 *
 * @param start - Where the drag began, in pixels from the left.
 * @param end - Where it ended.
 * @param timeAt - The instant at a horizontal offset.
 * @returns The start and end instants, or `undefined`.
 */
export function selectedStretch(
  start: number,
  end: number,
  timeAt: (x: number) => number,
): readonly [number, number] | undefined {
  if (Math.abs(end - start) < minimumWidth) return undefined;
  const [from, to] = [timeAt(Math.min(start, end)), timeAt(Math.max(start, end))];
  return Number.isFinite(from) && Number.isFinite(to) && from < to ? [from, to] : undefined;
}

/** A drag in progress: where it began and where the pointer is, in pixels from the left. */
interface Band {
  readonly start: number;
  readonly end: number;
}

/**
 * The pointer's offset from the left of the frame.
 *
 * @param event - The pointer event on the frame.
 * @returns The offset in pixels.
 */
function xOf(event: PointerEvent<HTMLDivElement>): number {
  return event.clientX - event.currentTarget.getBoundingClientRect().left;
}

/**
 * Where a drag starts, when the press can start one: a mouse or pen's main button, inside the
 * chart's plot. A finger is left to scroll the page.
 *
 * @param event - The press on the frame.
 * @param chart - The chart's instance.
 * @returns The offset it starts at, or `undefined`.
 */
function dragStart(event: PointerEvent<HTMLDivElement>, chart: EChartsType): number | undefined {
  if (event.pointerType === 'touch' || event.button !== 0) return undefined;
  const x = xOf(event);
  const y = event.clientY - event.currentTarget.getBoundingClientRect().top;
  return chart.containPixel({ gridIndex: 0 }, [x, y]) ? x : undefined;
}

/**
 * The handlers that draw the band while dragging and select its stretch when it is let go.
 *
 * @param chartOf - The chart's instance, when it is drawn.
 * @param band - The drag in progress, if any.
 * @param setBand - Changes it.
 * @param selected - What a selected stretch does.
 * @returns The pointer handlers.
 */
function bandHandlers(
  chartOf: () => EChartsType | undefined,
  band: Band | undefined,
  setBand: (band: Band | undefined) => void,
  selected: RangeSelected,
) {
  return {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      const chart = chartOf();
      const start = chart && dragStart(event, chart);
      if (start === undefined) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      setBand({ start, end: start });
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      if (band) setBand({ ...band, end: xOf(event) });
    },
    onPointerUp: () => {
      const chart = chartOf();
      setBand(undefined);
      if (!band || !chart) return;
      const timeAt = (x: number) => Number(chart.convertFromPixel({ xAxisIndex: 0 }, x));
      const stretch = selectedStretch(band.start, band.end, timeAt);
      if (stretch) selected(...stretch);
    },
  };
}

/**
 * The pointer handlers that select a stretch of a chart, and the band to draw while dragging.
 * Nothing selects when the chart does not draw over time or no dashboard is around it.
 *
 * @param chartOf - The chart's instance, when it is drawn.
 * @param enabled - Whether the chart draws over time with no zoom of its own.
 * @returns The handlers to put on the chart's frame, and the band, if dragging.
 */
export function useRangeSelect(chartOf: () => EChartsType | undefined, enabled: boolean) {
  const selected = useContext(RangeSelectContext);
  const [band, setBand] = useState<Band | undefined>(undefined);
  if (!enabled || !selected) return { handlers: {}, band: undefined };
  return { handlers: bandHandlers(chartOf, band, setBand, selected), band };
}
