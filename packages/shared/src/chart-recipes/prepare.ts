/**
 * How the chart adapter turns datasets into what a chart draws. A recipe names one; the spec keeps
 * it, so a pinned chart draws the same way whatever the catalogue becomes.
 */

/** The ways the adapter prepares data for a chart. */
export const prepareKinds = [
  /** x and one or more y columns; a long table is pivoted, one series per y column. */
  'cartesian',
  /** As cartesian, each row scaled so its values add up to 1, for 100% stacks. */
  'shares',
  /** As cartesian, categories sorted by their first value, largest first, and cut to the limit. */
  'ranked',
  /** Points split by a group column, one series per group, as scatter charts want. */
  'groups',
  /** One item per category, as pies and funnels take them; extra categories become "Other". */
  'items',
  /** x, y and value cells, as heatmaps take them; the colour scale follows the data. */
  'matrix',
  /** Raw values binned into a histogram: columns `bin` and `count`. */
  'bins',
  /** Raw values summarised per group: columns `group`, `min`, `q1`, `median`, `q3`, `max`. */
  'boxplot',
  /** Level columns and a value built into a tree, for treemaps and sunbursts. */
  'tree',
  /** Link rows built into nodes and links, for sankeys and graphs. */
  'graph',
  /** Categories as radar indicators, one polygon per series. */
  'radar',
  /** Daily values laid on a calendar, whose range follows the data. */
  'calendar',
  /** The last value on a dial. */
  'gauge',
  /** The last value as a big number, with the rest as a sparkline. */
  'kpi',
  /** Values per region name, on a map. */
  'regions',
  /** Values at latitude and longitude, on a map. */
  'points',
  /** Several number columns as parallel axes. */
  'parallel',
  /** One small chart per value of a facet column, sharing axes. */
  'facets',
  /** Changes stacked on an invisible running total: columns `category`, `base`, `change`. */
  'waterfall',
  /** Nothing to prepare: the option's encode reads the columns as they are. */
  'none',
] as const;

/** A way the adapter prepares data. */
export type PrepareKind = (typeof prepareKinds)[number];
