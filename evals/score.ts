/**
 * Scores what the agent built for a question against what a good answer holds. Pure, so a saved
 * report can be scored again with no model call (`--rescore`).
 */
import type { TurnUsage } from '@quanthea/shared';
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
}

/** A question's score: pass or not, and why not. */
export interface Score {
  /** Whether every expectation held. */
  readonly pass: boolean;
  /** What did not hold. */
  readonly reasons: readonly string[];
}

/**
 * What the panels miss: topics no panel shows, and connectors no panel queries.
 *
 * @param outcome - What was built.
 * @param expect - What a good answer holds.
 * @returns The reasons.
 */
function missing(outcome: Outcome, expect: Expectation): string[] {
  const texts = outcome.panels.map((panel) => panel.text);
  const topics = expect.topics
    .filter((topic) => !texts.some((text) => topic.test(text)))
    .map((topic) => `no panel about ${topic.source}`);
  const used = new Set(outcome.panels.flatMap((panel) => panel.connectors));
  const connectors = expect.connectors
    .filter((connector) => !used.has(connector))
    .map((connector) => `never queries ${connector}`);
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
  const reasons = [...faults(outcome, expect), ...missing(outcome, expect)];
  return { pass: reasons.length === 0, reasons };
}
