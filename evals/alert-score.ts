/**
 * Scores what an alert conversation saved against what a good alert holds: the spec, its replay
 * over yesterday's incident, the tools the agent used and what it said. Pure, so a saved report can
 * be scored again with no model call (`--rescore`).
 */
import {
  type AlertSpec,
  durationMs,
  type TurnUsage,
  thresholdText,
  unknownPlaceholders,
} from '@quanthea/shared';
import type { AlertExpectation } from './alert-cases.ts';
import type { Score } from './score.ts';

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

/**
 * What is wrong with the condition: its kind, direction, threshold and wait.
 *
 * @param spec - The spec.
 * @param expect - What a good alert holds.
 * @returns The reasons.
 */
function conditionFaults(spec: AlertSpec, expect: AlertExpectation): string[] {
  const { condition } = spec;
  if (condition.kind !== 'threshold') return ['the condition is not a threshold'];
  const reasons = condition.op === 'above' ? [] : ['the condition fires below, not above'];
  const wanted = expect.threshold * (inPercent(spec) ? 100 : 1);
  if (Math.abs(condition.value - wanted) > wanted * thresholdTolerance)
    reasons.push(`the threshold is ${condition.value}, expected ${wanted}`);
  if (expect.for !== undefined && durationMs(condition.for) !== durationMs(expect.for))
    reasons.push(`the condition holds for ${condition.for}, expected ${expect.for}`);
  return reasons;
}

/**
 * What is wrong with the message template and the channels.
 *
 * @param spec - The spec.
 * @param channelIds - The channels the agent was offered.
 * @returns The reasons.
 */
function messageFaults(spec: AlertSpec, channelIds: readonly string[]): string[] {
  const { title, body, fields } = spec.message;
  const texts = [title, body, ...fields.map((field) => field.value)];
  const unknown = texts.flatMap(unknownPlaceholders);
  const reasons = unknown.length > 0 ? [`the message uses unknown {${unknown.join('}, {')}}`] : [];
  if (!texts.some((text) => text.includes('{alert}') || text.includes('{value}')))
    reasons.push('the message names neither {alert} nor {value}');
  const strangers = spec.channels.filter((id) => !channelIds.includes(id));
  if (strangers.length > 0)
    reasons.push(`the alert names unknown channels: ${strangers.join(', ')}`);
  return reasons;
}

/**
 * Whether the alert tells the services apart or keeps to checkout.
 *
 * @param spec - The spec.
 * @returns The reasons.
 */
function splitFaults(spec: AlertSpec): string[] {
  const query = JSON.stringify(spec.query);
  const bySeries = /\bby\s*\([^)]*\bservice\b/i.test(query) || spec.value.by?.includes('service');
  if (bySeries || /checkout/i.test(query)) return [];
  return ['the alert neither tells services apart nor keeps to checkout'];
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
 * @param outcome - What the case gave.
 * @param spec - The spec.
 * @returns The reasons.
 */
function replayFaults(outcome: AlertCaseOutcome, spec: AlertSpec): string[] {
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
 * What is wrong with what the agent did: the replay tool, what it said, the new version.
 *
 * @param outcome - What the case gave.
 * @param expect - What a good alert holds.
 * @returns The reasons.
 */
function conductFaults(outcome: AlertCaseOutcome, expect: AlertExpectation): string[] {
  const reasons: string[] = [];
  const replays = outcome.toolCalls.replay_alert ?? 0;
  if (expect.noReplayTool && replays > 0)
    reasons.push(`called replay_alert ${replays} times, expected none`);
  if (expect.admitsNoReplay && !cannotReplay.test(outcome.said))
    reasons.push('the agent never says it cannot replay the numbers');
  if (expect.newVersion && outcome.versions === 0) reasons.push('no new version was saved');
  return reasons;
}

/**
 * What is wrong with the alert made from a panel: the query and the link.
 *
 * @param outcome - What the case gave.
 * @returns The reasons.
 */
function panelFaults(outcome: AlertCaseOutcome): string[] {
  const { panel } = outcome;
  if (!panel) return ['the panel was not read'];
  const reasons =
    panel.alert === panel.panel ? [] : ["the alert's query does not match the panel's"];
  if (!panel.links.includes('from_panel')) reasons.push('no from_panel link to the panel');
  return reasons;
}

/**
 * Scores an alert case's outcome.
 *
 * @param outcome - What the case gave.
 * @param expect - What a good alert holds.
 * @returns Pass or not, and why not.
 */
export function scoreAlert(outcome: AlertCaseOutcome, expect: AlertExpectation): Score {
  if (outcome.error !== undefined)
    return { pass: false, reasons: [`the run failed: ${outcome.error}`] };
  const { spec } = outcome;
  if (!spec) return { pass: false, reasons: ['no alert version was saved'] };
  const connector =
    spec.query.connector === expect.connector
      ? []
      : [`the query runs on ${spec.query.connector}, expected ${expect.connector}`];
  const reasons = [
    ...connector,
    ...conditionFaults(spec, expect),
    ...splitFaults(spec),
    ...messageFaults(spec, outcome.channelIds),
    ...(expect.checkoutFiresOnce ? replayFaults(outcome, spec) : []),
    ...conductFaults(outcome, expect),
    ...(expect.matchesPanel ? panelFaults(outcome) : []),
  ];
  return { pass: reasons.length === 0, reasons };
}

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
