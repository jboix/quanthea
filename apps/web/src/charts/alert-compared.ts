/**
 * What an alert's chart draws for a condition that compares a series with its own history: the
 * value a period before as a second line, or the band its recent history gives as a shaded range.
 * Both are in the secondary ink, not a series colour: they are what a series is held against.
 */
import type { Loose } from './loose.ts';
import type { ChartTheme } from './theme.ts';

/** A value at each evaluation. */
type Points = readonly { readonly at: number; readonly value: number | null }[];

/** The value a series had a period before, at each evaluation. */
export interface ReferenceLine {
  /** Its name, for the legend and tooltip, such as `a week earlier`. */
  readonly name: string;
  /** The value then, at each evaluation. */
  readonly points: Points;
}

/** The band a series' history gives, at each evaluation. */
export interface BandRange {
  /** Its name, for the legend and tooltip, such as `usual range`. */
  readonly name: string;
  /** Its edges at each evaluation; `null` with too little history. */
  readonly points: readonly {
    readonly at: number;
    readonly lower: number | null;
    readonly upper: number | null;
  }[];
}

/**
 * The names of the two series a band is drawn with.
 *
 * @param band - The band.
 * @returns The name of its lower edge and of its upper one, as the tooltip writes them.
 */
export function bandEdges(band: Pick<BandRange, 'name'>): { lower: string; upper: string } {
  return { lower: `${band.name}, from`, upper: `${band.name}, to` };
}

/** What the lines of the comparison share: no symbols, no pointer, no animation. */
const quiet = { type: 'line', showSymbol: false, silent: true, animation: false };

/**
 * The value a period before, as a thin dotted line.
 *
 * @param reference - The line, if the condition compares with the past.
 * @param theme - The theme.
 * @returns The line series, or none.
 */
export function referenceLine(reference: ReferenceLine | undefined, theme: ChartTheme): Loose[] {
  if (!reference) return [];
  const color = theme.inkSecondary;
  return [
    {
      ...quiet,
      name: reference.name,
      itemStyle: { color },
      lineStyle: { color, type: 'dotted', width: 1.5 },
      data: reference.points.map((point) => [point.at, point.value]),
    },
  ];
}

/**
 * The band, as a shaded range between its edges: the lower edge, and the width stacked on it. The
 * tooltip writes the upper edge, not the width.
 *
 * @param band - The band, if the condition has one.
 * @param theme - The theme.
 * @param format - Writes a value as the alert's format does.
 * @returns The two series, or none.
 */
export function bandRange(
  band: BandRange | undefined,
  theme: ChartTheme,
  format: (value: number) => string,
): Loose[] {
  if (!band) return [];
  const color = theme.inkSecondary;
  const edge = { ...quiet, stack: 'band', stackStrategy: 'all', itemStyle: { color } };
  const lineStyle = { color, width: 1, opacity: 0.5 };
  const width = ({ lower, upper }: BandRange['points'][number]) =>
    lower === null || upper === null ? null : upper - lower;
  const upperText = (_width: unknown, index: number) => {
    const upper = band.points[index]?.upper;
    return upper === null || upper === undefined ? '–' : format(upper);
  };
  return [
    {
      ...edge,
      name: bandEdges(band).lower,
      lineStyle,
      data: band.points.map((point) => [point.at, point.lower]),
    },
    {
      ...edge,
      name: bandEdges(band).upper,
      lineStyle,
      areaStyle: { color, opacity: 0.12 },
      tooltip: { valueFormatter: upperText },
      data: band.points.map((point) => [point.at, width(point)]),
    },
  ];
}
