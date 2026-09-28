/**
 * Assembles the agent's instructions for one turn: the fixed rules and spec guide, then what is
 * true now: the time, the connectors, the thread's state and plan, its current draft, and the
 * panels the person mentions.
 */
import type { DashboardSpec, Plan } from '@querent/shared';
import type { ModelConnector } from '../gate/model-view.ts';
import type { ThreadState } from '../threads/state.ts';
import { example, formatterGuide, rules, specGuide } from './prompt-text.ts';

/** What the instructions of a turn depend on. */
export interface TurnFacts {
  /** The current instant. */
  readonly now: number;
  /** The connectors, as the model view lists them. */
  readonly connectors: readonly ModelConnector[];
  /** The thread's state. */
  readonly state: ThreadState;
  /** The latest plan of the thread, if any, and its status. */
  readonly plan: { readonly body: Plan; readonly status: string } | undefined;
  /** The thread's current draft, if it has a dashboard. */
  readonly draft: { readonly version: number; readonly spec: DashboardSpec } | undefined;
  /** Panels the person mentioned in the latest message, by id and title. */
  readonly mentions: readonly { readonly panelId: string; readonly title: string }[];
}

/**
 * What the thread's state asks of the agent now.
 *
 * @param facts - The facts of the turn.
 * @returns One or two sentences.
 */
function stateLine(facts: TurnFacts): string {
  const { state, plan } = facts;
  if (state === 'plan_pending') {
    return 'A plan waits for the person to approve it. Answer questions, and propose a new plan if they ask for changes, but do not write the dashboard.';
  }
  if (state === 'building' && plan?.status === 'approved') {
    return `The plan "${plan.body.title}" is approved. Build it now with write_dashboard, following the plan:\n${JSON.stringify(plan.body)}`;
  }
  if (state === 'ready')
    return 'The dashboard is built. Small edits to existing panels need no plan; new panels need a new plan.';
  return 'No plan yet. Explore, test your queries, then propose a plan.';
}

/**
 * The part of the instructions that changes every turn.
 *
 * @param facts - The facts of the turn.
 * @returns The text.
 */
function situation(facts: TurnFacts): string {
  const lines = [
    `Now: ${new Date(facts.now).toISOString()} (UTC).`,
    `Connectors: ${JSON.stringify(facts.connectors)}`,
    `Thread: ${stateLine(facts)}`,
  ];
  if (facts.draft)
    lines.push(
      `Current draft, version ${facts.draft.version}:\n${JSON.stringify(facts.draft.spec)}`,
    );
  if (facts.mentions.length > 0) {
    const named = facts.mentions
      .map((mention) => `${mention.panelId} ("${mention.title}")`)
      .join(', ');
    lines.push(
      `The person mentions these panels: ${named}. Change only those unless they ask for more.`,
    );
  }
  return lines.join('\n\n');
}

/**
 * The instructions of a turn.
 *
 * @param facts - The facts of the turn.
 * @returns The system instructions.
 */
export function instructionsFor(facts: TurnFacts): string {
  return [rules, specGuide, formatterGuide, example, situation(facts)].join('\n\n');
}
