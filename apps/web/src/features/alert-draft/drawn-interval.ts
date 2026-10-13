/**
 * The interval a replay chart is drawn at. A replay holds one value per check, `every` apart,
 * with the firing periods and the spikes those checks give. The chart draws every check unless a
 * person chooses otherwise: a threshold is placed against the peaks of the checks, which a mean
 * flattens. A person may choose fewer points: one per interval of a closed list, the mean of the
 * checks in it. Only the lines change. The firing
 * periods, the spikes and the summary stay those of the checks, and a replay judged again under
 * another condition reads the checks, never the drawn points.
 */
import {
  type ChartInterval,
  chartIntervalChoices,
  durationMs,
  type Reading,
  type ReplayPoint,
} from '@quanthea/shared';
import { everyWords } from './condition.ts';

/** The choice that draws the checks as they are, one point each. It is the one nobody made. */
const everyCheck = 'every check';

/** What the chip of a replay chart offers. */
export type DrawnOption = typeof everyCheck | ChartInterval;

/** How a replay chart is drawn. */
export interface Drawn {
  /** What the chip offers: every check, then the intervals of the window. */
  readonly options: readonly DrawnOption[];
  /** The option shown as chosen. */
  readonly value: DrawnOption;
  /** The interval a point stands for, or `null` when the chart draws every check. */
  readonly interval: ChartInterval | null;
}

/** What of a replay says how it can be drawn: its window and the time between its checks. */
interface ReplaySpan {
  /** The first check. */
  readonly from: number;
  /** The last check at most. */
  readonly to: number;
  /** The time between checks. */
  readonly stepMs: number;
}

/**
 * How a replay is drawn under a choice. The intervals offered are those of the closed list that
 * suit the window and are wider than the time between checks.
 *
 * @param replay - The window of the replay and the time between its checks.
 * @param chosen - What the chip holds; a choice the window does not offer reads as every check.
 * @returns The options, the one shown and the interval drawn.
 */
export function drawnAt(replay: ReplaySpan, chosen: DrawnOption): Drawn {
  const periodMs = replay.to - replay.from;
  const choices = chartIntervalChoices(periodMs, replay.stepMs + 1);
  const options = [everyCheck, ...choices] as const;
  const value = options.includes(chosen) ? chosen : everyCheck;
  return { options, value, interval: choices.find((each) => each === value) ?? null };
}

/**
 * The mean of the numbers among some values.
 *
 * @param values - The values; a missing one is left out.
 * @returns The mean, or `null` when none is a number.
 */
function meanOf(values: readonly (number | null | undefined)[]): number | null {
  const known = values.filter((value) => typeof value === 'number');
  if (known.length === 0) return null;
  return known.reduce((sum, value) => sum + value, 0) / known.length;
}

/** The numbers a reading may carry besides its value. */
const readingExtras = ['reference', 'spread', 'numerator', 'denominator'] as const;

/**
 * The reading that stands for the readings of one test over an interval: the mean of each number.
 *
 * @param readings - What the test read at each check of the interval.
 * @returns The mean reading; a number no check carried is left out.
 */
function meanReading(readings: readonly (Reading | undefined)[]): Reading {
  const extras = readingExtras.flatMap((key) => {
    const values = readings.map((reading) => reading?.[key]);
    return values.some((value) => value !== undefined) ? [[key, meanOf(values)] as const] : [];
  });
  return {
    value: meanOf(readings.map((reading) => reading?.value)),
    ...Object.fromEntries(extras),
  };
}

/**
 * The point that stands for the checks of one interval: the mean of their values, at the mean of
 * their times, with the mean of what each test read.
 *
 * @param checks - The checks of the interval, at least one.
 * @returns The point.
 */
function meanPoint(checks: readonly ReplayPoint[]): ReplayPoint {
  const at = Math.round(checks.reduce((sum, check) => sum + check.at, 0) / checks.length);
  const value = meanOf(checks.map((check) => check.value));
  const tests = Math.max(...checks.map((check) => check.readings?.length ?? 0));
  if (tests === 0) return { at, value };
  const readings = Array.from({ length: tests }, (_, index) =>
    meanReading(checks.map((check) => check.readings?.[index])),
  );
  return { at, value, readings };
}

/**
 * The points a chart draws for the checks of a series: every check, or one point per interval,
 * the mean of the checks in it. Intervals are cut on the clock in UTC, so an hour starts on the
 * hour. An interval without a check draws nothing, and one whose checks saw no value draws a gap.
 *
 * @param checks - The value at each check, in time order.
 * @param interval - The interval drawn, or `null` for every check.
 * @returns The points to draw.
 */
export function drawnPoints(
  checks: readonly ReplayPoint[],
  interval: ChartInterval | null,
): readonly ReplayPoint[] {
  if (interval === null) return checks;
  const widthMs = durationMs(interval);
  const pieces = new Map<number, ReplayPoint[]>();
  for (const check of checks) {
    const piece = Math.floor(check.at / widthMs);
    pieces.set(piece, [...(pieces.get(piece) ?? []), check]);
  }
  return [...pieces.values()].map(meanPoint);
}

/**
 * What a chart says of its interval and of how often the alert is checked, which are two things.
 *
 * @param interval - The interval drawn, or `null` for every check.
 * @param every - How often the alert is checked, such as `1m`.
 * @returns The sentence under the chart.
 */
export function drawnNote(interval: ChartInterval | null, every: string): string {
  const checked = everyWords(every);
  if (interval === null) return `The chart draws every check: the alert is checked ${checked}.`;
  return `The chart draws one point per ${interval}, the mean of the checks in it. The alert is still checked ${checked}: the firing periods come from those checks, not from the line.`;
}
