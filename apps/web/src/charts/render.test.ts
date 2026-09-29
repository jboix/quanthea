import { afterAll, beforeAll, describe, expect, mock, spyOn, test } from 'bun:test';
import { type ChartRecipe, chartRecipes, fillView } from '@querent/shared';
import { init, use } from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import { buildChartOption } from './build-option.ts';
import { registerWorld } from './maps.ts';
import './register.ts';
import { defaultTheme } from './theme.ts';

use([SVGRenderer]);

/** What ECharts complained about while a chart drew. */
const complaints: string[] = [];

/**
 * Keeps a complaint instead of printing it.
 *
 * @param parts - What was logged.
 */
function keep(...parts: unknown[]): void {
  complaints.push(parts.join(' '));
}

beforeAll(async () => {
  registerWorld(await Bun.file(new URL('./maps/world.geojson', import.meta.url)).text());
  spyOn(console, 'warn').mockImplementation(keep);
  spyOn(console, 'error').mockImplementation(keep);
});

afterAll(() => {
  mock.restore();
});

/**
 * Draws a recipe's sample with some variants, headless, as SVG.
 *
 * @param recipe - The recipe.
 * @param variants - The variants.
 * @returns The option drawn, the SVG and what ECharts complained about.
 */
function draw(recipe: ChartRecipe, variants: string[]) {
  const choice = {
    recipe: recipe.id,
    roles: recipe.sample.roles,
    variants,
    unit: 'number' as const,
  };
  const filled = fillView(recipe, choice, ['A'], recipe.sample.datasets[0]);
  if (!('view' in filled) || filled.view.kind !== 'chart')
    throw new Error(`${recipe.id} is not a chart.`);
  const option = buildChartOption(
    { view: filled.view, datasets: recipe.sample.datasets, markers: [] },
    { theme: defaultTheme, timeZone: 'UTC' },
  );
  complaints.length = 0;
  const chart = init(null, null, { renderer: 'svg', ssr: true, width: 640, height: 320 });
  try {
    chart.setOption(option);
    return { option, svg: chart.renderToSVGString(), complaints: [...complaints] };
  } finally {
    chart.dispose();
  }
}

describe('every chart recipe draws its sample', () => {
  const charts = chartRecipes.filter((recipe) => recipe.render === 'echarts');
  for (const recipe of charts) {
    for (const variants of [[], ...Object.keys(recipe.variants).map((name) => [name])]) {
      test(`${recipe.id}${variants.length ? ` · ${variants[0]}` : ''}`, () => {
        const drawn = draw(recipe, variants);
        expect(drawn.complaints).toEqual([]);
        expect(JSON.stringify(drawn.option)).not.toMatch(/"@[a-zA-Z]/);
        expect(
          drawn.svg.match(/<(path|polygon|polyline|rect|circle)\b/g)?.length ?? 0,
        ).toBeGreaterThan(2);
      });
    }
  }
});
