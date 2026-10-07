/**
 * An alert's check and replay as the model may see them. The check says which series the alert
 * would watch now and whether its condition holds; the replay says how it would have fired. Both
 * reveal data, so the access level decides: level 1 shows that the query ran, level 2 how many
 * series there are and their label names, level 3 and 4 the labels, values and times. A replay is
 * a summary only, never the points, and only from level 3. Hidden labels never show.
 */
import type { AccessLevel } from '@quanthea/shared';
import { type GateSubject, hiddenResultNames, isHiddenResultName } from './subject.ts';

/** A series of an alert as one evaluation now would see it. */
export interface AlertSeriesNow {
  /** The labels. */
  readonly labels: Readonly<Record<string, string>>;
  /** Its value now. */
  readonly value: number | null;
  /** Whether the condition holds for it now. */
  readonly holds: boolean;
}

/** What the model learns of an alert's check. */
export type ModelAlertCheck =
  | { readonly level: 1; readonly note: string }
  | { readonly level: 2; readonly seriesCount: number; readonly labelNames: readonly string[] }
  | {
      readonly level: 3 | 4;
      readonly seriesCount: number;
      readonly holdingNow: number;
      readonly series: readonly { labels: string; value: number | null; holds: boolean }[];
    };

/** One series of a replay, as the server returns it. */
export interface ReplayedSeriesView {
  /** The labels. */
  readonly labels: Readonly<Record<string, string>>;
  /** When it fired. */
  readonly firing: readonly { from: number; to: number; ongoing: boolean }[];
  /** How many times it started firing. */
  readonly firings: number;
  /** How long it fired, in milliseconds. */
  readonly firingMs: number;
  /** When the condition held too briefly to fire. */
  readonly tooShort: readonly { from: number; to: number; peak: number | null }[];
}

/** A replay, as the server returns it. */
export type ReplayView =
  | { readonly replayable: false; readonly reason: string }
  | {
      readonly replayable: true;
      readonly from: number;
      readonly to: number;
      readonly series: readonly ReplayedSeriesView[];
      readonly truncated: boolean;
    };

/** The most series a check or a replay names. */
const maxNamed = 10;

/** The most periods named per series. */
const maxPeriods = 5;

/** Why a replay is refused below level 3. */
export const replayRefusal =
  'The replay shows values and times, which this connector’s access level does not let you see. Work without it, and tell the person they can read the replay in the draft pane.';

/**
 * Labels without the hidden ones.
 *
 * @param labels - The labels.
 * @param hidden - The hidden names.
 * @returns The visible labels.
 */
function visibleLabels(
  labels: Readonly<Record<string, string>>,
  hidden: ReadonlySet<string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(labels).filter(([name]) => !isHiddenResultName(name, hidden)),
  );
}

/**
 * Labels in words.
 *
 * @param labels - The visible labels.
 * @returns Such as `service=checkout, code=500`, or `all` without labels.
 */
function labelText(labels: Readonly<Record<string, string>>): string {
  const pairs = Object.entries(labels).map(([name, value]) => `${name}=${value}`);
  return pairs.length === 0 ? 'all' : pairs.join(', ');
}

/**
 * An alert's check as the model may see it.
 *
 * @param subject - The connector the query ran on.
 * @param series - The series the check found.
 * @returns What the access level lets through.
 */
export function modelAlertCheck(
  subject: GateSubject,
  series: readonly AlertSeriesNow[],
): ModelAlertCheck {
  const level: AccessLevel = subject.accessLevel;
  if (level === 1)
    return { level, note: 'The query ran. Your access level shows nothing of its result.' };
  const hidden = hiddenResultNames(subject);
  const visible = series.map((each) => ({ ...each, labels: visibleLabels(each.labels, hidden) }));
  if (level === 2) {
    const labelNames = [...new Set(visible.flatMap((each) => Object.keys(each.labels)))];
    return { level, seriesCount: series.length, labelNames };
  }
  const named = visible.slice(0, maxNamed).map((each) => ({
    labels: labelText(each.labels),
    value: each.value,
    holds: each.holds,
  }));
  const holdingNow = series.filter((each) => each.holds).length;
  return { level, seriesCount: series.length, holdingNow, series: named };
}

/**
 * An instant in words.
 *
 * @param at - Epoch milliseconds.
 * @returns The ISO time, to the minute.
 */
function isoMinute(at: number): string {
  return new Date(at).toISOString().slice(0, 16).concat('Z');
}

/**
 * One series of a replay in short, with its periods as times.
 *
 * @param series - The series.
 * @param hidden - The hidden label names.
 * @returns The summary.
 */
function seriesSummary(series: ReplayedSeriesView, hidden: ReadonlySet<string>) {
  return {
    series: labelText(visibleLabels(series.labels, hidden)),
    firings: series.firings,
    firingMinutes: Math.round(series.firingMs / 60_000),
    fired: series.firing.slice(0, maxPeriods).map((period) => ({
      from: isoMinute(period.from),
      to: period.ongoing ? 'still firing' : isoMinute(period.to),
    })),
    tooShort: series.tooShort.slice(0, maxPeriods).map((spike) => ({
      from: isoMinute(spike.from),
      minutes: Math.round((spike.to - spike.from) / 60_000),
      peak: spike.peak,
    })),
  };
}

/**
 * A replay as the model may see it: counts, firing periods and the spikes too short to fire, for
 * the series that fired most, never the points. Refused below level 3.
 *
 * @param subject - The connector the query ran on.
 * @param replay - The replay.
 * @returns The summary, or why not.
 */
export function modelAlertReplay(subject: GateSubject, replay: ReplayView) {
  if (subject.accessLevel < 3) return { ok: false as const, error: replayRefusal };
  if (!replay.replayable) return { ok: false as const, error: replay.reason };
  const hidden = hiddenResultNames(subject);
  const ranked = [...replay.series].sort(
    (first, second) =>
      second.firingMs - first.firingMs || second.tooShort.length - first.tooShort.length,
  );
  const sum = (count: (series: ReplayedSeriesView) => number) =>
    replay.series.reduce((total, series) => total + count(series), 0);
  return {
    ok: true as const,
    from: isoMinute(replay.from),
    to: isoMinute(replay.to),
    seriesCount: replay.series.length,
    seriesThatFired: replay.series.filter((series) => series.firings > 0).length,
    firings: sum((series) => series.firings),
    firingMinutes: Math.round(sum((series) => series.firingMs) / 60_000),
    tooShort: sum((series) => series.tooShort.length),
    series: ranked.slice(0, maxNamed).map((series) => seriesSummary(series, hidden)),
    truncated: replay.truncated,
  };
}
