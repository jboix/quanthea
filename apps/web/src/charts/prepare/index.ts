/** The preparation of each kind, by the name a view gives it. */
import type { PrepareKind } from '@quanthea/shared';
import { cartesian, groups, items, ranked, shares } from './cartesian.ts';
import { facets } from './facets.ts';
import { calendar, gauge, kpi, matrix, points, regions } from './places.ts';
import { graph, parallel, radar, tree } from './structures.ts';
import { bins, boxplot, waterfall } from './summaries.ts';
import type { Prepared, PrepareInput } from './types.ts';

export type { Prepared, PrepareInput } from './types.ts';

/** The preparation of each kind. */
const preparations: Readonly<Record<PrepareKind, (input: PrepareInput) => Prepared>> = {
  cartesian,
  shares,
  ranked,
  groups,
  items,
  matrix,
  bins,
  boxplot,
  tree,
  graph,
  radar,
  calendar,
  gauge,
  kpi,
  regions,
  points,
  parallel,
  facets,
  waterfall,
  none: (input) => ({ datasets: input.datasets, option: input.option, roles: input.roles }),
};

/**
 * Prepares a chart's data.
 *
 * @param kind - How.
 * @param input - The option, datasets, roles, limit and time zone.
 * @returns The prepared data.
 */
export function prepareChart(kind: PrepareKind, input: PrepareInput): Prepared {
  return preparations[kind](input);
}
