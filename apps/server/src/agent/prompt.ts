/**
 * Assembles the agent's instructions for one turn: who it is and its rules, the spec guide once it
 * writes, then what is true now: the time, the connectors' catalog, the current draft, the panels
 * the person mentions, and last what the thread's phase asks of it.
 */
import type { DashboardSpec, Plan } from '@querent/shared';
import type { ThreadState } from '../threads/state.ts';
import { phaseOf } from './phases.ts';
import {
  buildingRules,
  editingRules,
  example,
  formatterGuide,
  generalRules,
  persona,
  planningRules,
  specGuide,
} from './prompt-text.ts';

/** What the instructions of a turn depend on. */
export interface TurnFacts {
  /** The current instant. */
  readonly now: number;
  /** The connectors' catalog: schemas and common values, as the gate shows them. */
  readonly catalog: string;
  /** The thread's state. */
  readonly state: ThreadState;
  /** The latest plan of the thread, if any, and its status. */
  readonly plan: { readonly body: Plan; readonly status: string } | undefined;
  /** The thread's current draft, if it has a dashboard. */
  readonly draft: { readonly version: number; readonly spec: DashboardSpec } | undefined;
  /** Panels the person mentioned in the latest message, by id and title. */
  readonly mentions: readonly { readonly panelId: string; readonly title: string }[];
  /** The person's IANA time zone, when their browser said. */
  readonly timeZone?: string | undefined;
}

/**
 * What the thread's state asks of the agent now.
 *
 * @param facts - The facts of the turn.
 * @returns The phase's rules, with the approved plan when building.
 */
function stateLine(facts: TurnFacts): string {
  const { state, plan } = facts;
  if (state === 'plan_pending') {
    return `${planningRules}\nA plan waits for the person to approve it. Answer questions about it, and propose a new plan if they ask for changes.`;
  }
  if (state === 'building' && plan?.status === 'approved') {
    return `${buildingRules}\nThe approved plan "${plan.body.title}":\n${JSON.stringify(plan.body)}`;
  }
  if (state === 'ready') return editingRules;
  return `${planningRules}\nNo plan yet.`;
}

/**
 * The current time, in UTC and in the person's zone, so "yesterday around 14:00" reads right.
 *
 * @param now - The current instant.
 * @param timeZone - The person's zone, if known.
 * @returns The line.
 */
function nowLine(now: number, timeZone: string | undefined): string {
  const utc = `Current time: ${new Date(now).toISOString()} (UTC).`;
  if (timeZone === undefined) return `${utc} The person's time zone is unknown; assume UTC.`;
  try {
    const local = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      dateStyle: 'short',
      timeStyle: 'short',
      hourCycle: 'h23',
    }).format(now);
    return `${utc} The person is in ${timeZone}, where it is ${local}. Times they mention are in their zone unless they say otherwise.`;
  } catch {
    return `${utc} The person's time zone is unknown; assume UTC.`;
  }
}

/**
 * The part of the instructions that changes every turn.
 *
 * @param facts - The facts of the turn.
 * @returns The text.
 */
function situation(facts: TurnFacts): string {
  const lines = [
    nowLine(facts.now, facts.timeZone),
    `Connectors and their data (the catalog):\n${facts.catalog}`,
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
  return [...lines, stateLine(facts)].join('\n\n');
}

/**
 * The instructions of a turn. The spec guide and the example come only once there is something to
 * write, so planning turns stay short.
 *
 * @param facts - The facts of the turn.
 * @returns The system instructions.
 */
export function instructionsFor(facts: TurnFacts): string {
  const writing = phaseOf(facts.state) === 'planning' ? [] : [specGuide, formatterGuide, example];
  return [persona, generalRules, ...writing, situation(facts)].join('\n\n');
}
