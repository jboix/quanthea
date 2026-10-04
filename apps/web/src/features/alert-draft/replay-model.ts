/**
 * A draft's replay at the threshold a person drags: the series replayed again in the browser with
 * the server's rules (`replayAtThreshold`), the series the chart draws, and the summary line.
 */
import {
  type AlertReplay,
  type AlertSpec,
  type NotifiedSeries,
  type ReplayThreshold,
  type ReplayTrack,
  replayAtThreshold,
} from '@quanthea/shared';

/** A replay that ran. */
export type Replayed = Extract<AlertReplay, { replayable: true }>;

/** One series of a replay. */
type ReplaySeries = Replayed['series'][number];

/** A series with how it would behave at the threshold shown. */
export interface TrackedSeries {
  /** The series key. */
  readonly key: string;
  /** Its labels. */
  readonly labels: Readonly<Record<string, string>>;
  /** How it would behave. */
  readonly track: ReplayTrack;
}

/** The most series the chart draws: those that fired longest. */
export const maxChartSeries = 5;

/**
 * Every series at a threshold: replayed again from its values when the threshold moved, as the
 * server replayed it otherwise. A series that came without its values keeps the server's result.
 *
 * @param replay - The replay.
 * @param spec - The draft's spec.
 * @param threshold - The threshold to replay at.
 * @returns The series and how each would behave.
 */
export function seriesAt(replay: Replayed, spec: AlertSpec, threshold: number): TrackedSeries[] {
  const { condition } = spec;
  if (condition.kind !== 'threshold' || condition.value === threshold) return asReplayed(replay);
  return seriesUnder(replay, { ...condition, value: threshold }, spec.every);
}

/**
 * Every series as the server replayed it.
 *
 * @param replay - The replay.
 * @returns The series and how each behaved.
 */
export function asReplayed(replay: Replayed): TrackedSeries[] {
  return replay.series.map(({ key, labels, ...track }) => ({ key, labels, track }));
}

/**
 * Every series replayed again from its values under another condition: another threshold,
 * operator or wait. A series that came without its values keeps the server's result.
 *
 * @param replay - The replay.
 * @param condition - The condition to replay under.
 * @param every - How often the alert is evaluated.
 * @returns The series and how each would behave.
 */
export function seriesUnder(
  replay: Replayed,
  condition: ReplayThreshold,
  every: string,
): TrackedSeries[] {
  return replay.series.map(({ key, labels, ...track }) => ({
    key,
    labels,
    track:
      track.points.length > 0
        ? replayAtThreshold(track.points, condition, every, replay.to)
        : track,
  }));
}

/**
 * The series that fired longest first, then those with the most short spikes, then by key.
 *
 * @param series - The series.
 * @returns A sorted copy.
 */
export function byFiring(series: readonly TrackedSeries[]): TrackedSeries[] {
  return [...series].sort(
    (first, second) =>
      second.track.firingMs - first.track.firingMs ||
      second.track.tooShort.length - first.track.tooShort.length ||
      first.key.localeCompare(second.key),
  );
}

/** How a replay adds up over its series. */
export interface ReplaySummary {
  /** How many times it would have fired, over every series. */
  readonly firings: number;
  /** How long it would have fired, in milliseconds. */
  readonly firingMs: number;
  /** The spikes too short to fire. */
  readonly tooShort: number;
}

/**
 * Adds a replay up.
 *
 * @param series - The series.
 * @returns The totals.
 */
export function summarize(series: readonly TrackedSeries[]): ReplaySummary {
  return series.reduce<ReplaySummary>(
    (sum, { track }) => ({
      firings: sum.firings + track.firings,
      firingMs: sum.firingMs + track.firingMs,
      tooShort: sum.tooShort + track.tooShort.length,
    }),
    { firings: 0, firingMs: 0, tooShort: 0 },
  );
}

/**
 * A span in words.
 *
 * @param ms - The span.
 * @returns Such as `23 minutes` or `3 h 10 min`.
 */
export function spanText(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const rest = minutes % 60;
  return rest === 0 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${rest} min`;
}

/**
 * The summary line under the chart.
 *
 * @param summary - The totals.
 * @returns Such as `Would have fired 2 times · 23 minutes in total · 1 spike too short to fire`.
 */
export function summaryText(summary: ReplaySummary): string {
  const spikes =
    summary.tooShort === 0
      ? []
      : [`${summary.tooShort} ${summary.tooShort === 1 ? 'spike' : 'spikes'} too short to fire`];
  if (summary.firings === 0) return ['Would not have fired', ...spikes].join(' · ');
  const times = summary.firings === 1 ? 'once' : `${summary.firings} times`;
  return [`Would have fired ${times}`, `${spanText(summary.firingMs)} in total`, ...spikes].join(
    ' · ',
  );
}

/**
 * The value of a series at an instant, from its points.
 *
 * @param series - The series.
 * @param at - The instant.
 * @returns The value at the last evaluation at or before it.
 */
function valueAt(series: ReplaySeries, at: number): number | null {
  return series.points.findLast((point) => point.at <= at)?.value ?? null;
}

/**
 * A firing to fill the message previews and the test with: the first firing of the series that
 * fired longest, or that series' last value when none fired.
 *
 * @param replay - The replay.
 * @returns The series, or `null` for a replay without series.
 */
export function sampleFiring(replay: Replayed): NotifiedSeries | null {
  const [first] = [...replay.series].sort((a, b) => b.firingMs - a.firingMs);
  if (!first) return null;
  const period = first.firing[0];
  if (period)
    return { labels: first.labels, value: valueAt(first, period.from), since: period.from };
  return { labels: first.labels, value: valueAt(first, replay.to), since: replay.to };
}
