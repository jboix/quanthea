/**
 * Small helpers that turn a series of numbers into SVG path data, for the site's drawn charts.
 */

/** The plot area of a chart, in SVG units. */
export interface PlotArea {
  /** Left edge. */
  readonly left: number;
  /** Right edge. */
  readonly right: number;
  /** Top edge. */
  readonly top: number;
  /** Bottom edge. */
  readonly bottom: number;
}

/**
 * Maps a value from a domain onto a range.
 *
 * @param value - The value.
 * @param domain - The domain's low and high ends.
 * @param range - The range's ends, matching the domain's.
 * @returns The mapped value.
 */
export function scale(
  value: number,
  domain: readonly [number, number],
  range: readonly [number, number],
): number {
  const share = (value - domain[0]) / (domain[1] - domain[0]);
  return range[0] + share * (range[1] - range[0]);
}

/**
 * The path of a line through evenly spaced values.
 *
 * @param values - The values, left to right.
 * @param area - The plot area.
 * @param domain - The values' low and high ends, drawn at the bottom and the top.
 * @returns The path data.
 */
export function linePath(
  values: readonly number[],
  area: PlotArea,
  domain: readonly [number, number],
): string {
  const step = (area.right - area.left) / Math.max(values.length - 1, 1);
  return values
    .map((value, index) => {
      const x = area.left + index * step;
      const y = scale(value, domain, [area.bottom, area.top]);
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

/**
 * A deterministic wavy series, for decorative sparklines.
 *
 * @param seed - Picks the series; the same seed gives the same series.
 * @param length - How many values.
 * @returns Values between 0 and 1.
 */
export function sparkValues(seed: number, length: number): number[] {
  return Array.from({ length }, (_, index) => {
    const wave = Math.sin(index * 0.55 + seed) * 0.28 + Math.sin(index * 0.19 + seed * 2.1) * 0.18;
    return 0.5 + wave;
  });
}

/**
 * The points of evenly spaced values in a plot area.
 *
 * @param values - The values, left to right.
 * @param area - The plot area.
 * @param domain - The values' low and high ends, drawn at the bottom and the top.
 * @returns The points, as `[x, y]`.
 */
function pointsOf(
  values: readonly number[],
  area: PlotArea,
  domain: readonly [number, number],
): [number, number][] {
  const step = (area.right - area.left) / Math.max(values.length - 1, 1);
  return values.map((value, index) => [
    area.left + index * step,
    scale(value, domain, [area.bottom, area.top]),
  ]);
}

/**
 * The control points of the curve between two points, from their neighbours (Catmull-Rom).
 *
 * @param before - The point before the start, or the start itself.
 * @param start - The segment's start.
 * @param end - The segment's end.
 * @param after - The point after the end, or the end itself.
 * @returns The cubic segment's path data.
 */
function curveTo(
  before: [number, number],
  start: [number, number],
  end: [number, number],
  after: [number, number],
): string {
  const first = [start[0] + (end[0] - before[0]) / 6, start[1] + (end[1] - before[1]) / 6];
  const second = [end[0] - (after[0] - start[0]) / 6, end[1] - (after[1] - start[1]) / 6];
  const numbers = [...first, ...second, ...end].map((each) => each.toFixed(1));
  return `C${numbers.slice(0, 2).join(' ')} ${numbers.slice(2, 4).join(' ')} ${numbers.slice(4).join(' ')}`;
}

/**
 * The path of a smooth line through evenly spaced values, as a chart's smoothed series draws it.
 *
 * @param values - The values, left to right.
 * @param area - The plot area.
 * @param domain - The values' low and high ends, drawn at the bottom and the top.
 * @returns The path data.
 */
export function smoothPath(
  values: readonly number[],
  area: PlotArea,
  domain: readonly [number, number],
): string {
  const points = pointsOf(values, area, domain);
  const [first] = points;
  if (first === undefined) return '';
  const segments = points.slice(1).map((end, index) => {
    const start = points[index] ?? end;
    return curveTo(points[index - 1] ?? start, start, end, points[index + 2] ?? end);
  });
  return [`M${first[0].toFixed(1)} ${first[1].toFixed(1)}`, ...segments].join(' ');
}

/**
 * The path of the area under a smooth line, closed along the plot's bottom.
 *
 * @param values - The values, left to right.
 * @param area - The plot area.
 * @param domain - The values' low and high ends.
 * @returns The path data.
 */
export function smoothAreaPath(
  values: readonly number[],
  area: PlotArea,
  domain: readonly [number, number],
): string {
  const line = smoothPath(values, area, domain);
  if (line === '') return '';
  return `${line} L${area.right.toFixed(1)} ${area.bottom.toFixed(1)} L${area.left.toFixed(1)} ${area.bottom.toFixed(1)} Z`;
}
