import { afterAll, beforeAll, describe, expect, mock, spyOn, test } from 'bun:test';
import { type ChartRecipe, chartRecipes, fillView, type MarkerOutcome } from '@quanthea/shared';
import { getMap, init, use } from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import { buildChartOption } from './build-option.ts';
import { mapsOf, registerWorld } from './maps.ts';
import { ensureModules, needsOtherModules } from './register.ts';
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

/** The world map, registered once the geo modules are in, as the chart does. */
let world = '';

beforeAll(async () => {
  world = await Bun.file(new URL('./maps/world.geojson', import.meta.url)).text();
  spyOn(console, 'warn').mockImplementation(keep);
  spyOn(console, 'error').mockImplementation(keep);
});

afterAll(() => {
  mock.restore();
});

/**
 * The ECharts option of a recipe's sample with some variants.
 *
 * @param recipe - The recipe.
 * @param variants - The variants.
 * @param markers - The sets of markers to draw.
 * @returns The option.
 */
function optionOf(recipe: ChartRecipe, variants: string[], markers: MarkerOutcome[] = []) {
  const choice = {
    recipe: recipe.id,
    roles: recipe.sample.roles,
    variants,
    unit: 'number' as const,
  };
  const filled = fillView(recipe, choice, ['A'], recipe.sample.datasets[0]);
  if (!('view' in filled) || filled.view.kind !== 'chart')
    throw new Error(`${recipe.id} is not a chart.`);
  return buildChartOption(
    { view: filled.view, datasets: recipe.sample.datasets, markers },
    { theme: defaultTheme, timeZone: 'UTC' },
  );
}

/**
 * Draws an option headless, as SVG, with the modules it asks for registered as the chart does.
 *
 * @param option - The option.
 * @returns The SVG and what ECharts complained about.
 */
async function draw(option: ReturnType<typeof optionOf>) {
  await ensureModules(option);
  if (mapsOf(option).includes('world') && !getMap('world')) registerWorld(world);
  complaints.length = 0;
  const chart = init(null, null, { renderer: 'svg', ssr: true, width: 640, height: 320 });
  try {
    chart.setOption(option);
    return { svg: chart.renderToSVGString(), complaints: [...complaints] };
  } finally {
    chart.dispose();
  }
}

/** Every chart recipe with each of its variants, and the option of its sample. */
const samples = chartRecipes
  .filter((recipe) => recipe.render === 'echarts')
  .flatMap((recipe) =>
    [[], ...Object.keys(recipe.variants).map((name) => [name])].map((variants) => ({
      name: `${recipe.id}${variants.length ? ` · ${variants[0]}` : ''}`,
      option: optionOf(recipe, variants),
    })),
  );

/**
 * Tests that a sample draws: no complaint, no theme token left, and shapes on the canvas.
 *
 * @param sample - The sample.
 * @param sample.name - Its test name.
 * @param sample.option - Its option.
 */
function drawsIt({ name, option }: (typeof samples)[number]): void {
  test(name, async () => {
    const drawn = await draw(option);
    expect(drawn.complaints).toEqual([]);
    expect(JSON.stringify(option)).not.toMatch(/"@[a-zA-Z]/);
    expect(drawn.svg.match(/<(path|polygon|polyline|rect|circle)\b/g)?.length ?? 0).toBeGreaterThan(
      2,
    );
  });
}

// The common recipes draw first, before any recipe loads the other modules: a recipe that needs
// them but is not seen to would complain here.
describe('every common chart recipe draws its sample with the common modules', () => {
  for (const sample of samples.filter((each) => !needsOtherModules(each.option))) drawsIt(sample);
});

describe('every other chart recipe draws its sample once its modules load', () => {
  for (const sample of samples.filter((each) => needsOtherModules(each.option))) drawsIt(sample);
});

describe('markers', () => {
  test('draw each set in its colour on a time chart, with no complaint', async () => {
    const recipe = chartRecipes.find((each) => each.id === 'trend.line');
    if (!recipe) throw new Error('No line chart.');
    const [first] = recipe.sample.datasets;
    const timeIndex = first?.dimensions.findIndex((column) => column.type === 'time') ?? -1;
    const time = Number(first?.source[1]?.[timeIndex]);
    const set = (color: MarkerOutcome['color'], text: string): MarkerOutcome => ({
      annotation: text,
      label: text,
      color,
      points: [{ time, text }],
      error: null,
    });
    const option = optionOf(recipe, [], [set('@ink', 'deploy'), set('@palette.5', 'incident')]);
    const drawn = await draw(option);
    expect(drawn.complaints).toEqual([]);
    expect(drawn.svg).toContain(defaultTheme.palette[5] ?? 'none');
    expect(drawn.svg).toContain('incident');
  });
});
