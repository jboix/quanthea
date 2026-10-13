/**
 * The checks of a report a thread wrote, and the evidence they read: the schedule, the period, the
 * comparison, the headline panels, the connector, the preview, the channels, and the numbers of a
 * run against the database's own. Each check is one assertion, pure, so a saved report can be
 * scored again with no model call (`--rescore`).
 */
import type { Headline, ReportPeriod, ReportSpec, TurnUsage, Weekday } from '@quanthea/shared';
import type { Check } from '../core/case.ts';
import { topicWords } from './dashboard.ts';

/** The orders of a run's period, counted on the dev Postgres directly. */
export interface OrderTruth {
  /** The paid orders. */
  readonly paid: number;
  /** Every order attempt: paid, refunded and failed. */
  readonly all: number;
  /** The failed ones. */
  readonly failed: number;
  /** The paid orders' totals, in cents. */
  readonly paidCents: number;
  /** Every order attempt's total, in cents. */
  readonly allCents: number;
}

/** A run of the saved version, as the report keeps it: no panel results. */
export interface RunSummary {
  /** `ok`, `failed` or `running`. */
  readonly status: string;
  /** Why it failed, when it did. */
  readonly error: string | null;
  /** The period it covered. */
  readonly period: { readonly from: number; readonly to: number; readonly label: string };
  /** Its headline numbers. */
  readonly headlines: readonly Headline[];
}

/** What happened when the agent wrote a report for a case. */
export interface ReportCaseOutcome {
  /** Marks a report case's outcome apart from the others. */
  readonly kind: 'report';
  /** The case's id. */
  readonly id: string;
  /** The spec of the report's latest version, when it has one. */
  readonly spec?: ReportSpec;
  /** How many versions the case saved. */
  readonly versions: number;
  /** The ids of the channels the agent was offered. */
  readonly channelIds: readonly string[];
  /** Why the preview of the latest version failed, `null` when every query ran. */
  readonly previewFailure?: string | null;
  /** A run of the latest version, made now, when the case checks one. */
  readonly run?: RunSummary;
  /** The orders of the run's period, from the database. */
  readonly truth?: OrderTruth;
  /** The model's tool calls, by tool name. */
  readonly toolCalls: Readonly<Record<string, number>>;
  /** What the agent said in the case's turns. */
  readonly said: string;
  /** What the agent asked the person. */
  readonly asked: readonly string[];
  /** How many writes failed their checks. */
  readonly repairs: number;
  /** How many runs it took. */
  readonly turns: number;
  /** The tokens spent, by model. */
  readonly usage: TurnUsage;
  /** How long it took, in milliseconds. */
  readonly durationMs: number;
  /** Why a run failed, when one did. */
  readonly error?: string;
}

/** The schedule a good report runs on; a field left out takes any value. */
export interface ScheduleExpectation {
  /** Every day or every week. */
  readonly every: 'day' | 'week';
  /** The weekday of a weekly schedule. */
  readonly weekday?: Weekday;
  /** The time of day, such as `07:00`. */
  readonly at: string;
  /** The time zone of its clock. */
  readonly timezone: string;
}

/** A check of a report a thread wrote. */
export type ReportCheck = Check<ReportCaseOutcome>;

/**
 * A check of the saved spec: it says nothing when no version was saved, which {@link saved} says.
 * A legacy check of a report stands in for a check of its run's numbers.
 *
 * @param id - The check's name.
 * @param kind - How it decides.
 * @param faults - What does not hold in the spec.
 * @returns The check.
 */
function onSpec(
  id: string,
  kind: ReportCheck['kind'],
  faults: (spec: ReportSpec, outcome: ReportCaseOutcome) => readonly string[],
): ReportCheck {
  const standsInFor = kind === 'legacy' ? { standsInFor: 'result' as const } : {};
  const read: ReportCheck['faults'] = (outcome) =>
    outcome.spec ? faults(outcome.spec, outcome) : [];
  return { id, kind, ...standsInFor, faults: read };
}

/** The thread saved a report version. Nothing else can be checked without one. */
export const saved: ReportCheck = {
  id: 'saved',
  kind: 'structure',
  gate: true,
  faults: (outcome) => (outcome.spec ? [] : ['no report version was saved']),
};

/** The report sends only to channels the agent was offered. */
export const knownChannels: ReportCheck = onSpec('known-channels', 'structure', (spec, outcome) => {
  const strangers = spec.delivery.channels.filter((id) => !outcome.channelIds.includes(id));
  return strangers.length > 0 ? [`the report names unknown channels: ${strangers.join(', ')}`] : [];
});

/** Every query of the latest version runs over its latest period, as the draft pane previews it. */
export const previews: ReportCheck = {
  id: 'previews',
  kind: 'structure',
  faults: (outcome) =>
    outcome.previewFailure === null
      ? []
      : [`the preview failed: ${outcome.previewFailure ?? 'it did not run'}`],
};

/** The checks every report case runs before its own. */
export const reportDefaults: readonly ReportCheck[] = [saved, knownChannels, previews];

/**
 * What is wrong with the schedule.
 *
 * @param schedule - The spec's schedule.
 * @param wanted - The schedule a good report runs on.
 * @returns The reasons.
 */
function scheduleFaults(schedule: ReportSpec['schedule'], wanted: ScheduleExpectation): string[] {
  const reasons: string[] = [];
  if (schedule.every !== wanted.every)
    reasons.push(`it runs every ${schedule.every}, expected every ${wanted.every}`);
  const weekday = schedule.every === 'week' ? schedule.weekday : undefined;
  if (wanted.weekday !== undefined && weekday !== wanted.weekday)
    reasons.push(`it runs on ${weekday ?? 'no weekday'}, expected ${wanted.weekday}`);
  if (schedule.at !== wanted.at) reasons.push(`it runs at ${schedule.at}, expected ${wanted.at}`);
  if (schedule.timezone !== wanted.timezone)
    reasons.push(`its clock is ${schedule.timezone}, expected ${wanted.timezone}`);
  return reasons;
}

/**
 * The report runs on a schedule.
 *
 * @param wanted - The schedule; a field left out takes any value.
 * @returns The check.
 */
export function runsOn(wanted: ScheduleExpectation): ReportCheck {
  return onSpec('runs-on', 'feature', (spec) => scheduleFaults(spec.schedule, wanted));
}

/**
 * Each run covers a period.
 *
 * @param period - The period.
 * @returns The check.
 */
export function covers(period: ReportPeriod): ReportCheck {
  return onSpec('covers', 'feature', (spec) =>
    spec.period === period ? [] : [`it covers ${spec.period}, expected ${period}`],
  );
}

/**
 * Each run compares with something, or with nothing.
 *
 * @param compare - What it compares with.
 * @returns The check.
 */
export function comparesWith(compare: 'previous_period' | 'none'): ReportCheck {
  return onSpec('compares-with', 'feature', (spec) =>
    spec.compare === compare ? [] : [`it compares with ${spec.compare}, expected ${compare}`],
  );
}

/**
 * The summary panels of a spec, each as its title and queries written out.
 *
 * @param spec - The spec.
 * @returns The texts, in the summary's order.
 */
function summaryTexts(spec: ReportSpec): string[] {
  return spec.summaryPanels.flatMap((id) => {
    const panel = spec.panels.find((each) => each.id === id);
    return panel ? [`${panel.title}\n${JSON.stringify(panel.queries)}`] : [];
  });
}

/**
 * A pattern matches a headline panel's title or query. It stands in for a reading of what the
 * headline shows, until a rubric or a result check does it.
 *
 * @param pattern - The pattern.
 * @returns The check.
 */
export function headline(pattern: RegExp): ReportCheck {
  const check = onSpec(`headline:${pattern.source}`, 'legacy', (spec) =>
    summaryTexts(spec).some((text) => pattern.test(text))
      ? []
      : [`no headline panel shows ${topicWords(pattern)}`],
  );
  return { ...check, pattern };
}

/**
 * Every panel's queries run on one connector.
 *
 * @param connector - The connector's name.
 * @returns The check.
 */
export function queriesOnly(connector: string): ReportCheck {
  return onSpec(`queries-only:${connector}`, 'structure', (spec) => {
    const elsewhere = spec.panels.flatMap((panel) =>
      panel.queries.filter((query) => query.connector !== connector).map(() => panel.title),
    );
    return elsewhere.length > 0
      ? [`panels query another connector than ${connector}: ${elsewhere.join(', ')}`]
      : [];
  });
}

/** The case saved a version of its own: a report that had one already has one more. */
export const savesNewVersion: ReportCheck = {
  id: 'saves-new-version',
  kind: 'structure',
  faults: (outcome) => (outcome.spec && outcome.versions === 0 ? ['no new version was saved'] : []),
};

/**
 * Whether an outcome is a report case's.
 *
 * @param outcome - The outcome.
 * @returns Whether it is a report case's.
 */
export function isReport<Other extends object>(
  outcome: ReportCaseOutcome | Other,
): outcome is ReportCaseOutcome {
  return 'kind' in outcome && outcome.kind === 'report';
}
