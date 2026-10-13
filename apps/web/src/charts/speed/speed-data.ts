/**
 * The made-up data of the chart speed page: long, fine-grained series with spikes and dips,
 * drawn through the same views and option builders as a dashboard's panels.
 */
import { type ChartView, chartRecipes, type Dataset, fillView } from '@quanthea/shared';
import type { ChartInput } from '../build-option.ts';

/**
 * What the series of the page are drawn as. `holed` is a line whose source left out a few
 * minutes in three places, as a source does that returns only the rows it has.
 */
export const speedKinds = ['line', 'bar', 'scatter', 'holed'] as const;

/** A kind of series the page draws. */
export type SpeedKind = (typeof speedKinds)[number];

/** The first instant of every series, in epoch milliseconds. */
const start = Date.UTC(2026, 0, 1);

/** A minute, in milliseconds. */
const minute = 60_000;

/**
 * A repeatable source of numbers, so two runs draw the same series.
 *
 * @param seed - Where the sequence starts.
 * @returns The next number between 0 and 1, each call.
 */
function seeded(seed: number): () => number {
  let state = seed * 2_654_435_761 + 1;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

/**
 * The value of one point: a wave with noise, a spike every 997 points and a dip to zero every
 * 1499. No point is missing: a line with a missing value is not sampled, so it would time the
 * usual drawing.
 *
 * @param index - The point's place.
 * @param points - How many points the series has.
 * @param noise - A number between 0 and 1.
 * @returns The value.
 */
function valueAt(index: number, points: number, noise: number): number {
  if (index % 997 === 500) return 400 + noise * 50;
  if (index % 1499 === 700) return 0;
  return Math.round((100 + 40 * Math.sin((index / points) * 8 * Math.PI) + noise * 20) * 100) / 100;
}

/** How many rows in a row each hole of a holed series leaves out. */
const holeRows = 3;

/**
 * Whether a row falls in one of the three holes of a holed series: at a quarter, a half and
 * three quarters of its length.
 *
 * @param index - The row's place.
 * @param points - How many points the series has.
 * @returns `true` for a row a holed series leaves out.
 */
function inHole(index: number, points: number): boolean {
  const quarter = Math.floor(points / 4);
  return quarter > holeRows && index >= quarter && index % quarter < holeRows;
}

/**
 * One series of the page: a value every minute.
 *
 * @param points - How many points.
 * @param seed - Which series, so each chart draws its own.
 * @param holed - Whether the series leaves out the rows of its three holes.
 * @returns The dataset, with a `time` and a `requests` column.
 */
export function speedDataset(points: number, seed: number, holed = false): Dataset {
  const random = seeded(seed);
  const rows = Array.from({ length: points }, (_point, index) => [
    start + index * minute,
    valueAt(index, points, random()),
  ]);
  return {
    dimensions: [
      { name: 'time', type: 'time' },
      { name: 'requests', type: 'number' },
    ],
    source: holed ? rows.filter((_row, index) => !inHole(index, points)) : rows,
  };
}

/**
 * The view of the page's charts: the line recipe as a dashboard fills it, its series drawn as
 * the kind asked for.
 *
 * @param kind - What the series are drawn as.
 * @returns The chart view.
 * @throws {Error} When the line recipe is missing or does not fill.
 */
export function speedView(kind: SpeedKind): ChartView {
  const recipe = chartRecipes.find((each) => each.id === 'trend.line');
  if (!recipe) throw new Error('No line recipe.');
  const choice = {
    recipe: recipe.id,
    roles: { x: 'time', y: 'requests' },
    unit: 'number' as const,
  };
  const filled = fillView(recipe, choice, ['A']);
  if (!('view' in filled) || filled.view.kind !== 'chart')
    throw new Error('The line recipe did not fill.');
  const { view } = filled;
  const series = [view.option.series ?? []]
    .flat()
    .map((each) => ({ ...(each as object), type: kind === 'holed' ? 'line' : kind }));
  return { ...view, option: { ...view.option, series } };
}

/**
 * What each chart of the page draws.
 *
 * @param kind - What the series are drawn as.
 * @param points - How many points each chart has.
 * @param charts - How many charts.
 * @returns The inputs, one per chart.
 */
export function speedInputs(kind: SpeedKind, points: number, charts: number): ChartInput[] {
  const view = speedView(kind);
  return Array.from({ length: charts }, (_chart, index) => ({
    view,
    datasets: [speedDataset(points, index + 1, kind === 'holed')],
    markers: [],
  }));
}
