/**
 * Scores what the agent built for a question against what a good answer holds. Pure, so a saved
 * report can be scored again with no model call (`--rescore`).
 */
import { fixedTimeOf, type PanelQuery, type TurnUsage } from '@quanthea/shared';
import type { Expectation } from './questions.ts';

/** One panel of the dashboard built, as the scoring reads it. */
export interface BuiltPanel {
  /** Its id. */
  readonly id: string;
  /** Its title. */
  readonly title: string;
  /** The connectors its queries use. */
  readonly connectors: readonly string[];
  /** Its title and queries, written out, for the topics. */
  readonly text: string;
}

/** What happened when the agent answered a question. */
export interface Outcome {
  /** The question's id. */
  readonly id: string;
  /** Whether the thread ended with a dashboard ready for edits. */
  readonly built: boolean;
  /** The panels of the last version. */
  readonly panels: readonly BuiltPanel[];
  /** The marker sets of the last version, each shaped like a panel, if it has any. */
  readonly markers?: readonly BuiltPanel[];
  /** The queries of the last version that fail when run again, by panel. */
  readonly failing: readonly { readonly panelId: string; readonly error: string }[];
  /** How many writes failed their checks or test runs. */
  readonly repairs: number;
  /** What the agent asked the person. */
  readonly asked: readonly string[];
  /** How many runs it took. */
  readonly turns: number;
  /** The tokens spent, by model. */
  readonly usage: TurnUsage;
  /** How long it took, in milliseconds. */
  readonly durationMs: number;
  /** Why a run failed, when one did, such as a provider error. */
  readonly error?: string;
  /** What the agent said last, to read when nothing was built. */
  readonly lastWords?: string;
}

/** A question's score: pass or not, and why not. */
export interface Score {
  /** Whether every expectation held. */
  readonly pass: boolean;
  /** What did not hold. */
  readonly reasons: readonly string[];
}

/**
 * A panel's queries, from the text the outcome keeps: its title, then its queries as JSON.
 *
 * @param panel - The panel.
 * @returns Its queries; none when the text holds none.
 */
export function panelQueries(panel: BuiltPanel): PanelQuery[] {
  try {
    return JSON.parse(panel.text.slice(panel.text.indexOf('\n') + 1)) as PanelQuery[];
  } catch {
    return [];
  }
}

/**
 * What the dashboard shows: its panels, then its marker sets.
 *
 * @param outcome - What was built.
 * @returns The panels and the marker sets.
 */
export function shownOf(outcome: Outcome): BuiltPanel[] {
  return [...outcome.panels, ...(outcome.markers ?? [])];
}

/**
 * A topic pattern, for a reason: its alternatives joined with "or".
 *
 * @param topic - The pattern.
 * @returns The words.
 */
function topicWords(topic: RegExp): string {
  return topic.source.split('|').join(' or ');
}

/**
 * Queries that name a fixed time instead of following the dashboard's range, in the panels and
 * the marker sets.
 *
 * @param outcome - What was built.
 * @returns The reasons.
 */
function fixedTimes(outcome: Outcome): string[] {
  return shownOf(outcome).flatMap((panel) =>
    panelQueries(panel).flatMap((query) => {
      const why = fixedTimeOf(query);
      return why ? [`${panel.id}: ${why.split(':')[0]}`] : [];
    }),
  );
}

/**
 * Panels that run the same query as an earlier one.
 *
 * @param outcome - What was built.
 * @returns The reasons.
 */
function duplicates(outcome: Outcome): string[] {
  const seen = new Map<string, string>();
  const reasons: string[] = [];
  for (const panel of outcome.panels) {
    const queries = panelQueries(panel);
    if (queries.length === 0) continue;
    const key = JSON.stringify(queries.map(({ refId: _refId, ...query }) => query));
    const first = seen.get(key);
    if (first) reasons.push(`${panel.id} runs the same query as ${first}`);
    else seen.set(key, panel.id);
  }
  return reasons;
}

/**
 * What the panels miss: topics no panel shows, and connectors no panel queries.
 *
 * @param outcome - What was built.
 * @param expect - What a good answer holds.
 * @returns The reasons.
 */
function missing(outcome: Outcome, expect: Expectation): string[] {
  const shown = shownOf(outcome);
  const texts = shown.map((panel) => panel.text);
  const topics = expect.topics
    .filter((topic) => !texts.some((text) => topic.test(text)))
    .map((topic) => `no panel about ${topicWords(topic)}`);
  const used = new Set(shown.flatMap((panel) => panel.connectors));
  const connectors = expect.connectors
    .filter((connector) => !used.has(connector))
    .map((connector) => `never queries ${connector}`);
  return [...topics, ...connectors];
}

/**
 * What the markers miss, when the answer needs them: any marker set at all, then the topics and
 * the connectors the expectation names.
 *
 * @param outcome - What was built.
 * @param expect - What a good answer holds.
 * @returns The reasons.
 */
function unmarked(outcome: Outcome, expect: Expectation): string[] {
  if (!expect.markers) return [];
  const markers = outcome.markers ?? [];
  if (markers.length === 0) return ['no markers on the charts'];
  const topics = expect.markers.topics
    .filter((topic) => !markers.some((marker) => topic.test(marker.text)))
    .map((topic) => `no markers about ${topicWords(topic)}`);
  const used = new Set(markers.flatMap((marker) => marker.connectors));
  const connectors = expect.markers.connectors
    .filter((connector) => !used.has(connector))
    .map((connector) => `no markers from ${connector}`);
  return [...topics, ...connectors];
}

/**
 * What is wrong with the build: the panel count, failing queries, and too many repairs.
 *
 * @param outcome - What was built.
 * @param expect - What a good answer holds.
 * @returns The reasons.
 */
function faults(outcome: Outcome, expect: Expectation): string[] {
  const [least, most] = expect.panels;
  const count = outcome.panels.length;
  const reasons =
    count < least || count > most ? [`${count} panels, expected ${least} to ${most}`] : [];
  for (const failure of outcome.failing) reasons.push(`${failure.panelId} fails: ${failure.error}`);
  if (outcome.repairs > expect.maxRepairs)
    reasons.push(`${outcome.repairs} failed writes, at most ${expect.maxRepairs}`);
  return reasons;
}

/**
 * Scores an outcome.
 *
 * @param outcome - What the agent built.
 * @param expect - What a good answer holds.
 * @returns Pass or not, and why not.
 */
export function score(outcome: Outcome, expect: Expectation): Score {
  if (outcome.error !== undefined)
    return { pass: false, reasons: [`the run failed: ${outcome.error}`] };
  if (!outcome.built) return { pass: false, reasons: ['no dashboard was built'] };
  const reasons = [
    ...faults(outcome, expect),
    ...missing(outcome, expect),
    ...unmarked(outcome, expect),
    ...fixedTimes(outcome),
    ...duplicates(outcome),
  ];
  return { pass: reasons.length === 0, reasons };
}
