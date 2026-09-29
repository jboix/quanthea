/**
 * Every chart recipe, and the short index the agent reads to pick one. The agent reads a recipe in
 * full only when it needs its roles and variants.
 */
import { bar } from './comparison/bar.ts';
import { bullet } from './comparison/bullet.ts';
import { lollipop } from './comparison/lollipop.ts';
import { rankedBar } from './comparison/ranked-bar.ts';
import { waterfall } from './comparison/waterfall.ts';
import { pie } from './composition/pie.ts';
import { sunburst } from './composition/sunburst.ts';
import { treemap } from './composition/treemap.ts';
import { boxplot } from './distribution/boxplot.ts';
import { calendarHeatmap } from './distribution/calendar-heatmap.ts';
import { histogram } from './distribution/histogram.ts';
import { scatterColor } from './distribution/scatter-color.ts';
import { funnel } from './flow/funnel.ts';
import { graph } from './flow/graph.ts';
import { sankey } from './flow/sankey.ts';
import { choropleth } from './geo/choropleth.ts';
import { points } from './geo/points.ts';
import { bigNumber } from './kpi/big-number.ts';
import { gauge } from './kpi/gauge.ts';
import { stat } from './kpi/stat.ts';
import { smallMultiples } from './layout/small-multiples.ts';
import type { ChartRecipe } from './recipe.ts';
import { bubble } from './relationship/bubble.ts';
import { heatmap } from './relationship/heatmap.ts';
import { parallel } from './relationship/parallel.ts';
import { radar } from './relationship/radar.ts';
import { scatter } from './relationship/scatter.ts';
import { rows } from './table/rows.ts';
import { candlestick } from './trend/candlestick.ts';
import { dualAxis } from './trend/dual-axis.ts';
import { line } from './trend/line.ts';
import { sparkline } from './trend/sparkline.ts';
import { thresholds } from './trend/thresholds.ts';

/** Every chart recipe, by family. */
export const chartRecipes: readonly ChartRecipe[] = [
  line,
  thresholds,
  dualAxis,
  sparkline,
  candlestick,
  bar,
  rankedBar,
  bullet,
  waterfall,
  lollipop,
  histogram,
  boxplot,
  scatterColor,
  calendarHeatmap,
  pie,
  treemap,
  sunburst,
  scatter,
  bubble,
  heatmap,
  parallel,
  radar,
  sankey,
  graph,
  funnel,
  choropleth,
  points,
  stat,
  bigNumber,
  gauge,
  rows,
  smallMultiples,
];

/**
 * A recipe by id.
 *
 * @param id - The id, such as `trend.line`.
 * @returns The recipe, if there is one.
 */
export function chartRecipe(id: string): ChartRecipe | undefined {
  return chartRecipes.find((recipe) => recipe.id === id);
}

/**
 * The index the agent reads: one line per recipe, with its shape and variants.
 *
 * @param recipes - The recipes to list; every recipe by default.
 * @returns The index.
 */
export function chartIndex(recipes: readonly ChartRecipe[] = chartRecipes): string {
  return recipes
    .map((recipe) => {
      const variants = Object.keys(recipe.variants);
      const suffix = variants.length > 0 ? ` Variants: ${variants.join(', ')}.` : '';
      return `${recipe.id} (${recipe.data.shape}): ${recipe.whenToUse[0]}${suffix}`;
    })
    .join('\n');
}
