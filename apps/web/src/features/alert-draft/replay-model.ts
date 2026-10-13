/**
 * A draft's replay under a condition a person changes, such as a threshold being dragged: the
 * series judged again in the browser with the server's rules (`replayUnder`), the series the
 * chart draws with the line the condition compares them against, and the summary line.
 */
import {
  type AlertCondition,
  type AlertReplay,
  type AlertSpec,
  changeLimit,
  conditionTests,
  type NotifiedSeries,
  type ReplayTrack,
  replayUnder,
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
 * Every series judged again from its readings under another condition: other numbers, operators,
 * directions, joiner or wait, on the same fields and spans. A series that came without its values
 * keeps the server's result, and so does every series under a `no_data` condition.
 *
 * @param replay - The replay.
 * @param condition - The condition to judge under.
 * @param every - How often the alert is evaluated.
 * @returns The series and how each would behave.
 */
export function seriesUnder(
  replay: Replayed,
  condition: AlertCondition,
  every: string,
): TrackedSeries[] {
  if (condition.kind === 'no_data') return asReplayed(replay);
  return replay.series.map(({ key, labels, ...track }) => ({
    key,
    labels,
    track: track.points.length > 0 ? replayUnder(track.points, condition, every, replay.to) : track,
  }));
}

/**
 * What the dashed line of a replay chart is, for its legend.
 *
 * @param condition - The condition.
 * @returns `threshold`, or the limit a change must reach.
 */
export function lineName(condition: AlertCondition): string {
  const [first] = conditionTests(condition);
  if (first?.kind !== 'change') return 'threshold';
  return first.direction === 'up' ? 'fires above this' : 'fires below this';
}

/** The lines a replay chart draws for what a condition compares a series against. */
export interface ConditionLines {
  /** The threshold of the condition's first test, when it is one; `null` otherwise. */
  readonly threshold: number | null;
  /**
   * The value a series must reach at each evaluation for the condition's first test to hold, when
   * it is a change: the earlier point moved by the amount.
   */
  readonly limit?: {
    readonly name: string;
    readonly points: { at: number; value: number | null }[];
  };
}

/**
 * What the chart draws for a condition, from its first test, which reads the alert's value: the
 * line of a threshold, or the moving limit of a change for one series.
 *
 * @param condition - The condition.
 * @param lead - The series whose limit is drawn, with its name; the one that fired longest.
 * @param lead.name - Its name, written beside the limit when the chart draws several series.
 * @param lead.points - Its points, with their readings.
 * @returns The lines.
 */
export function conditionLines(
  condition: AlertCondition,
  lead: { readonly name?: string | undefined; readonly points: ReplayTrack['points'] } | undefined,
): ConditionLines {
  const [first] = conditionTests(condition);
  if (first?.kind === 'threshold') return { threshold: first.value };
  if (first?.kind !== 'change' || !lead || lead.points.length === 0) return { threshold: null };
  const side = first.direction === 'up' ? 'fires above' : 'fires below';
  const points = lead.points.map(({ at, readings }) => ({
    at,
    value: changeLimit(first, readings?.[0]?.reference),
  }));
  return { threshold: null, limit: { name: lead.name ? `${side} (${lead.name})` : side, points } };
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
  const spikeWord = summary.tooShort === 1 ? 'spike' : 'spikes';
  const spikes =
    summary.tooShort === 0 ? [] : [`${summary.tooShort} ${spikeWord} too short to fire`];
  if (summary.firings === 0) return ['Would not have fired', ...spikes].join(' · ');
  const times = summary.firings === 1 ? 'once' : `${summary.firings} times`;
  return [`Would have fired ${times}`, `${spanText(summary.firingMs)} in total`, ...spikes].join(
    ' · ',
  );
}

/**
 * A series as a notification would name it at an instant, from its points.
 *
 * @param series - The series.
 * @param at - The instant.
 * @returns Its labels, and its value and readings at the last evaluation at or before it.
 */
function notifiedAt(series: ReplaySeries, at: number): NotifiedSeries {
  const point = series.points.findLast((each) => each.at <= at);
  const readings = point?.readings ? { readings: point.readings } : {};
  return { labels: series.labels, value: point?.value ?? null, since: at, ...readings };
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
  return notifiedAt(first, first.firing[0]?.from ?? replay.to);
}
