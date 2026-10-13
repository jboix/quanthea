/**
 * The checks of an alert a thread wrote, and the evidence they read: the spec, its replay over
 * yesterday's incident, the tools the agent used and what it said. Each check is one assertion,
 * pure, so a saved report can be scored again with no model call (`--rescore`).
 */
import {
  type AlertSpec,
  durationMs,
  type TurnUsage,
  thresholdText,
  unknownPlaceholders,
} from '@quanthea/shared';
import type { Check } from '../core/case.ts';
import { type ConditionExpectation, kindFaults } from './alert-condition.ts';

/** A period of time, in epoch milliseconds. */
export interface Period {
  /** When it started. */
  readonly from: number;
  /** When it ended. */
  readonly to: number;
}

/** One series of a replay, as the report keeps it: no points. */
export interface ReplayedSeriesSummary {
  /** Its labels. */
  readonly labels: Readonly<Record<string, string>>;
  /** When it fired; `ongoing` when it still fired at the end. */
  readonly firing: readonly (Period & { readonly ongoing: boolean })[];
  /** How many times the condition held, but not for long enough to fire. */
  readonly tooShort: number;
}

/** A replay of the saved version over yesterday, or why there is none. */
export type ReplaySummary =
  | { readonly replayable: true; readonly series: readonly ReplayedSeriesSummary[] }
  | { readonly replayable: false; readonly reason: string };

/** The query of the panel a thread started from, and the alert's, as fingerprints. */
export interface PanelMatch {
  /** The panel's query fingerprint. */
  readonly panel: string;
  /** The alert's query fingerprint. */
  readonly alert: string;
  /** How each link of the alert to that panel was made, such as `from_panel`. */
  readonly links: readonly string[];
}

/** What happened when the agent wrote an alert for a case. */
export interface AlertCaseOutcome {
  /** Marks an alert case's outcome apart from the others. */
  readonly kind: 'alert';
  /** The case's id. */
  readonly id: string;
  /** The spec of the alert's latest version, when it has one. */
  readonly spec?: AlertSpec;
  /** How many versions the case saved. */
  readonly versions: number;
  /** The ids of the channels the agent was offered. */
  readonly channelIds: readonly string[];
  /** When deploy #481 started the incident, in epoch milliseconds. */
  readonly incidentAt: number;
  /** The latest version replayed over yesterday. */
  readonly replay?: ReplaySummary;
  /** For a thread started from a panel: the fingerprints and the links. */
  readonly panel?: PanelMatch;
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

/** How long after the deploy checkout may start firing: the rise, the wait and some slack. */
const firingWithinMs = 20 * 60_000;

/** How far the threshold may be from the one asked, relative to it. */
const thresholdTolerance = 0.01;

/** Words that say the agent cannot replay, or that the draft pane shows the replay. */
const cannotReplay =
  /\b(?:cannot|can't|can’t|can not|unable to|not able to|no access|don't have access|do not have access)\b|draft pane/i;

/** A query multiplied by 100, so its values are percent. */
const percentScaled = /\*\s*100\b|\b100\s*\*/;

/**
 * Whether the alert's values are percent rather than a ratio.
 *
 * @param spec - The spec.
 * @returns Whether its query multiplies by 100.
 */
function inPercent(spec: AlertSpec): boolean {
  return percentScaled.test(JSON.stringify(spec.query));
}

/** A check of an alert a thread wrote. */
export type AlertCheck = Check<AlertCaseOutcome>;

/**
 * A check of the saved spec: it says nothing when no version was saved, which {@link saved} says.
 *
 * @param id - The check's name.
 * @param kind - How it decides.
 * @param faults - What does not hold in the spec.
 * @returns The check.
 */
function onSpec(
  id: string,
  kind: AlertCheck['kind'],
  faults: (spec: AlertSpec, outcome: AlertCaseOutcome) => readonly string[],
): AlertCheck {
  return { id, kind, faults: (outcome) => (outcome.spec ? faults(outcome.spec, outcome) : []) };
}

/** The thread saved an alert version. Nothing else can be checked without one. */
export const saved: AlertCheck = {
  id: 'saved',
  kind: 'structure',
  gate: true,
  faults: (outcome) => (outcome.spec ? [] : ['no alert version was saved']),
};

/** The message uses only the placeholders an alert has. */
export const knownPlaceholders: AlertCheck = onSpec('known-placeholders', 'structure', (spec) => {
  const unknown = messageTexts(spec).flatMap(unknownPlaceholders);
  return unknown.length > 0 ? [`the message uses unknown {${unknown.join('}, {')}}`] : [];
});

/** The message names the alert or its value. */
export const namesAlertOrValue: AlertCheck = onSpec('names-alert-or-value', 'structure', (spec) =>
  messageTexts(spec).some((text) => text.includes('{alert}') || text.includes('{value}'))
    ? []
    : ['the message names neither {alert} nor {value}'],
);

/** The alert notifies only channels the agent was offered. */
export const knownChannels: AlertCheck = onSpec('known-channels', 'structure', (spec, outcome) => {
  const strangers = spec.channels.filter((id) => !outcome.channelIds.includes(id));
  return strangers.length > 0 ? [`the alert names unknown channels: ${strangers.join(', ')}`] : [];
});

/** The alert tells the services apart or keeps to checkout. A case about one series leaves it out. */
export const tellsServicesApart: AlertCheck = onSpec(
  'tells-services-apart',
  'structure',
  (spec) => {
    const query = JSON.stringify(spec.query);
    const bySeries = /\bby\s*\([^)]*\bservice\b/i.test(query) || spec.value.by?.includes('service');
    if (bySeries || /checkout/i.test(query)) return [];
    return ['the alert neither tells services apart nor keeps to checkout'];
  },
);

/** The checks every alert case runs before its own. */
export const alertDefaults: readonly AlertCheck[] = [
  saved,
  tellsServicesApart,
  knownPlaceholders,
  namesAlertOrValue,
  knownChannels,
];

/**
 * The texts of a message template: its title, its body and its fields' values.
 *
 * @param spec - The spec.
 * @returns The texts.
 */
function messageTexts(spec: AlertSpec): string[] {
  const { title, body, fields } = spec.message;
  return [title, body, ...fields.map((field) => field.value)];
}

/**
 * The alert's query runs on a connector.
 *
 * @param connector - The connector's name.
 * @returns The check.
 */
export function runsOn(connector: string): AlertCheck {
  return onSpec(`runs-on:${connector}`, 'structure', (spec) =>
    spec.query.connector === connector
      ? []
      : [`the query runs on ${spec.query.connector}, expected ${connector}`],
  );
}

/**
 * The condition is a threshold the alert fires above, within 1%.
 *
 * @param threshold - The threshold, as a ratio: `0.02` for 2%. A query scaled to percent uses 2.
 * @returns The check.
 */
export function firesAbove(threshold: number): AlertCheck {
  return onSpec('fires-above', 'feature', (spec) => {
    const { condition } = spec;
    if (condition.kind !== 'threshold') return ['the condition is not a threshold'];
    const reasons = condition.op === 'above' ? [] : ['the condition fires below, not above'];
    const wanted = threshold * (inPercent(spec) ? 100 : 1);
    if (Math.abs(condition.value - wanted) > wanted * thresholdTolerance)
      reasons.push(`the threshold is ${condition.value}, expected ${wanted}`);
    return reasons;
  });
}

/**
 * The condition has a kind and the values the case asks for.
 *
 * @param expect - The kind and the values.
 * @returns The check.
 */
export function conditionIs(expect: ConditionExpectation): AlertCheck {
  return onSpec('condition-is', 'feature', (spec) => kindFaults(spec.condition, expect));
}

/**
 * The condition must hold for a time before the alert fires.
 *
 * @param wait - The time, such as `5m`.
 * @returns The check.
 */
export function holdsFor(wait: string): AlertCheck {
  return onSpec('holds-for', 'feature', ({ condition }) =>
    durationMs(condition.for) === durationMs(wait)
      ? []
      : [`the condition holds for ${condition.for}, expected ${wait}`],
  );
}

/**
 * The alert divides by a second query, which runs on a connector.
 *
 * @param connector - The connector's name.
 * @returns The check.
 */
export function dividesBy(connector: string): AlertCheck {
  return onSpec('divides-by', 'feature', (spec) => {
    const second = spec.dividedBy?.query.connector;
    if (second === undefined) return ['the alert has no second query to divide by'];
    return second === connector
      ? []
      : [`the second query runs on ${second}, expected ${connector}`];
  });
}

/**
 * The checkout series of a replay: the one labelled checkout, else the only one of an alert whose
 * query keeps to checkout.
 *
 * @param series - The replay's series.
 * @param spec - The spec.
 * @returns The series, if any.
 */
function checkoutSeries(
  series: readonly ReplayedSeriesSummary[],
  spec: AlertSpec,
): ReplayedSeriesSummary | undefined {
  const named = (each: ReplayedSeriesSummary) =>
    Object.values(each.labels).some((value) => /checkout/i.test(value));
  const labelled = series.find(named);
  if (labelled) return labelled;
  const keepsToCheckout = /checkout/i.test(JSON.stringify(spec.query));
  return keepsToCheckout && series.length === 1 ? series[0] : undefined;
}

/**
 * An instant as a UTC clock time.
 *
 * @param at - The instant.
 * @returns Such as `12:10 UTC`.
 */
export function utcClock(at: number): string {
  return `${new Date(at).toISOString().slice(11, 16)} UTC`;
}

/**
 * What is wrong with the replay: checkout must fire once, soon after the deploy.
 *
 * @param spec - The spec.
 * @param outcome - What the case gave.
 * @returns The faults.
 */
function replayFaults(spec: AlertSpec, outcome: AlertCaseOutcome): string[] {
  const { replay, incidentAt } = outcome;
  if (!replay) return ['the saved version was not replayed'];
  if (!replay.replayable) return [`the replay failed: ${replay.reason}`];
  const checkout = checkoutSeries(replay.series, spec);
  if (!checkout) return ['the replay has no checkout series'];
  const [first] = checkout.firing;
  if (checkout.firing.length !== 1 || !first)
    return [`checkout fired ${checkout.firing.length} times over yesterday, expected once`];
  if (first.from >= incidentAt && first.from <= incidentAt + firingWithinMs) return [];
  const window = `${utcClock(incidentAt)} to ${utcClock(incidentAt + firingWithinMs)}`;
  return [`checkout started firing at ${utcClock(first.from)}, expected ${window}`];
}

/**
 * Replayed over yesterday, the saved version fires for checkout once, soon after the deploy that
 * started the incident: what the dev data holds, whatever the query is written as.
 */
export const firesOnceOnIncident: AlertCheck = onSpec(
  'fires-once-on-incident',
  'result',
  replayFaults,
);

/** The agent never called the replay tool: a source that shows no numbers allows none. */
export const noReplayTool: AlertCheck = {
  id: 'no-replay-tool',
  kind: 'feature',
  faults: (outcome) => {
    const replays = outcome.toolCalls.replay_alert ?? 0;
    return replays > 0 ? [`called replay_alert ${replays} times, expected none`] : [];
  },
};

/** The agent says it cannot replay the numbers, by its words. */
export const admitsNoReplay: AlertCheck = {
  id: 'admits-no-replay',
  kind: 'legacy',
  standsInFor: 'rubric',
  faults: (outcome) =>
    cannotReplay.test(outcome.said) ? [] : ['the agent never says it cannot replay the numbers'],
};

/** The case saved a version of its own: an alert that had one already has one more. */
export const savesNewVersion: AlertCheck = {
  id: 'saves-new-version',
  kind: 'structure',
  faults: (outcome) => (outcome.versions === 0 ? ['no new version was saved'] : []),
};

/** The alert's query matches its panel's, and the alert links to the panel it started from. */
export const matchesPanel: AlertCheck = {
  id: 'matches-panel',
  kind: 'feature',
  faults: ({ panel }) => {
    if (!panel) return ['the panel was not read'];
    const reasons =
      panel.alert === panel.panel ? [] : ["the alert's query does not match the panel's"];
    if (!panel.links.includes('from_panel')) reasons.push('no from_panel link to the panel');
    return reasons;
  },
};

/**
 * The alert's condition in words, such as "above 2% for 5m, every 1m on prometheus-dev".
 *
 * @param spec - The spec.
 * @returns The words.
 */
export function conditionWords(spec: AlertSpec): string {
  const wait = spec.condition.for === '0m' ? 'at once' : `for ${spec.condition.for}`;
  return `${thresholdText(spec)} ${wait}, every ${spec.every} on ${spec.query.connector}`;
}

/**
 * Whether an outcome is an alert case's.
 *
 * @param outcome - The outcome.
 * @returns Whether it is an alert case's.
 */
export function isAlert<Other extends object>(
  outcome: AlertCaseOutcome | Other,
): outcome is AlertCaseOutcome {
  return 'kind' in outcome && outcome.kind === 'alert';
}
