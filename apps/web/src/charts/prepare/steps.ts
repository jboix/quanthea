/**
 * The steps of a gauge: the view's range mappings drawn as the colours of the dial. A step is
 * written in the value's own unit, and the dial wants shares of its length, so each bound is
 * placed between the gauge's `min` and `max`.
 */
import { isStep, type Mapping, mapValue, toneToken } from '@quanthea/shared';
import { isObject, type Loose } from '../loose.ts';

/** One colour stop of a dial: where it ends, as a share of the dial, and its colour token. */
type Stop = [number, string];

/**
 * A part of a series, as an object.
 *
 * @param value - The part, such as its `axisLine`.
 * @returns The part, or an empty object when the series has none.
 */
function partOf(value: unknown): Loose {
  return isObject(value) ? value : {};
}

/**
 * What a gauge's dial covers.
 *
 * @param series - The gauge series.
 * @returns Its `min` and `max`, 0 and 100 when left out as ECharts has them, or `undefined` when
 *   the dial has no length.
 */
function extentOf(series: Loose): [number, number] | undefined {
  const min = typeof series.min === 'number' ? series.min : 0;
  const max = typeof series.max === 'number' ? series.max : 100;
  return max > min ? [min, max] : undefined;
}

/**
 * The colour stops of a dial. The dial is cut at every bound of a step that falls on it, and each
 * stretch takes the tone of the first step that holds its start, as a value there would. A stretch
 * no step holds keeps the colour of the bare track.
 *
 * @param steps - The steps, in order.
 * @param extent - The dial's `min` and `max`.
 * @param soft - Whether the stops are tints, under a bar that takes the tone itself.
 * @returns The stops, in order, the last ending at 1.
 */
function stopsOf(steps: readonly Mapping[], extent: [number, number], soft: boolean): Stop[] {
  const [min, max] = extent;
  const bounds = steps
    .flatMap((step) => [step.match.from, step.match.to])
    .filter((bound): bound is number => bound !== undefined && bound > min && bound < max);
  const edges = [...new Set([min, ...bounds, max])].sort((a, b) => a - b);
  return edges.slice(1).map((end, index) => {
    const tone = mapValue(steps, edges[index])?.tone;
    return [(end - min) / (max - min), tone ? toneToken(tone, soft) : '@divider'];
  });
}

/**
 * The progress bar of a stepped gauge: in the tone of the step that holds the value, with flat
 * ends so it meets the stops squarely.
 *
 * @param progress - The series' `progress`.
 * @param steps - The steps, in order.
 * @param value - The value on the dial, or `null` when there is none.
 * @returns The progress bar.
 */
function steppedBar(progress: Loose, steps: readonly Mapping[], value: number | null): Loose {
  const tone = mapValue(steps, value)?.tone;
  const bar = { ...progress, roundCap: false };
  if (!tone) return bar;
  return { ...bar, itemStyle: { ...partOf(progress.itemStyle), color: toneToken(tone) } };
}

/**
 * A gauge series with its steps drawn. A gauge with a progress bar shows the steps as tints on
 * its track and the bar in the tone of its value, so where the bar ends still reads. A gauge with
 * a needle shows the steps in their tones.
 *
 * @param series - The gauge series.
 * @param mappings - The view's mappings, if any.
 * @param value - The value on the dial, or `null` when there is none.
 * @returns The series, unchanged when the view has no step or the dial has no length. A mapping
 *   that is not a step, which the validator refuses on a gauge, is left out.
 */
export function withSteps(
  series: Loose,
  mappings: readonly Mapping[] | undefined,
  value: number | null,
): Loose {
  const steps = (mappings ?? []).filter(isStep);
  const extent = extentOf(series);
  if (steps.length === 0 || !extent) return series;
  const progress = partOf(series.progress);
  const hasBar = progress.show === true;
  const axisLine = partOf(series.axisLine);
  const lineStyle = { ...partOf(axisLine.lineStyle), color: stopsOf(steps, extent, hasBar) };
  const stepped = { ...series, axisLine: { ...axisLine, roundCap: false, lineStyle } };
  return hasBar ? { ...stepped, progress: steppedBar(progress, steps, value) } : stepped;
}
