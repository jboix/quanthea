/**
 * A recipe's sample as a panel: the view the recipe fills with its sample's columns, and the sample
 * as a query result, so the gallery draws it through the same code as dashboards.
 */
import {
  type ChartRecipe,
  type Dataset,
  type Frame,
  fillView,
  type Panel,
  type QueryOutcome,
} from '@quanthea/shared';

/**
 * A dataset as the frame a query would return.
 *
 * @param dataset - The dataset.
 * @param refId - The query's reference.
 * @returns The frame.
 */
export function frameOf(dataset: Dataset, refId: string): Frame {
  const fields = dataset.dimensions.map(({ name, type, unit }) =>
    unit ? { name, type, unit } : { name, type },
  );
  const values = dataset.dimensions.map((_column, index) =>
    dataset.source.map((row) => row[index] ?? null),
  );
  return {
    refId,
    fields,
    values,
    meta: { rowCount: dataset.source.length, truncated: false, durationMs: 0 },
  };
}

/** A recipe's sample, ready to draw. */
export interface SamplePanel {
  /** The panel. */
  readonly panel: Panel;
  /** The sample, as query outcomes. */
  readonly queries: QueryOutcome[];
}

/**
 * A recipe's sample as a panel, with some variants.
 *
 * @param recipe - The recipe.
 * @param variants - The variants.
 * @returns The panel and its data, or why the recipe cannot draw its sample.
 */
export function samplePanel(
  recipe: ChartRecipe,
  variants: readonly string[],
): SamplePanel | string {
  const refs = recipe.sample.datasets.map((_dataset, index) => String.fromCharCode(65 + index));
  const choice = {
    recipe: recipe.id,
    roles: recipe.sample.roles,
    variants,
    unit: 'number' as const,
  };
  const filled = fillView(recipe, choice, refs, recipe.sample.datasets[0]);
  if ('problems' in filled) return filled.problems.join(' ');
  const queries = recipe.sample.datasets.map((dataset, index) => {
    const refId = refs[index] ?? 'A';
    return { refId, frames: [frameOf(dataset, refId)], error: null };
  });
  const panel = {
    id: 'sample',
    title: recipe.title,
    grid: { x: 0, y: 0, w: 6, h: 6 },
    queries: [],
    view: filled.view,
  };
  return { panel: panel as unknown as Panel, queries };
}
