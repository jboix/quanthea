/**
 * Assembles the agent's instructions for one turn. First what lasts from turn to turn, so providers
 * can cache it: who it is, its rules, the panel guide once it writes, the connectors' catalog. Then
 * what is true now: the time, the current draft, the panels the person mentions, and last what the
 * thread's phase asks of it.
 */
import type { DashboardSpec, Plan, QueryLanguage } from '@querent/shared';
import type { AvailableQueries } from '../dashboards/queries/index.ts';
import type { ThreadState } from '../threads/state.ts';
import { panelGuideFor } from './panel-guide.ts';
import { phaseOf } from './phases.ts';
import {
  buildingRules,
  editingRules,
  generalRules,
  persona,
  planningRules,
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
  /** Whether the person saw pinned dashboards that may answer this, and asked for a new one. */
  readonly declinedMatches?: boolean;
  /** The query builders and saved queries the thread may use. */
  readonly queries: AvailableQueries;
  /** The query languages of the connectors in use. */
  readonly languages: readonly QueryLanguage[];
  /** The connector kinds in use that have a query guide, which read_guide gives. */
  readonly guides: readonly { readonly kind: string }[];
  /** The chart recipes the agent is offered, by id; every one when not given. */
  readonly charts?: readonly string[];
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
  const declined = facts.declinedMatches
    ? ' The person saw pinned dashboards that may answer this and asked for a new one: do not offer them again.'
    : '';
  return `${planningRules}\nNo plan yet.${declined}`;
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
 * The part of the instructions that changes every turn: the time, the draft, the mentions, and
 * what the phase asks.
 *
 * @param facts - The facts of the turn.
 * @returns The text.
 */
function situation(facts: TurnFacts): string {
  const lines = [nowLine(facts.now, facts.timeZone)];
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

/** A turn's instructions, split where a cache can end. */
export interface InstructionParts {
  /** What stays the same from turn to turn: who the agent is, its rules, the guides, the catalog. */
  readonly lasting: string;
  /** What changes every turn: the time, the draft, the mentions, what the phase asks. */
  readonly turn: string;
}

/**
 * The instructions of a turn, the lasting part first so providers can cache it. The panel guide
 * comes only once there is something to write, so planning turns stay short.
 *
 * @param facts - The facts of the turn.
 * @returns The lasting part and the turn's part.
 */
export function instructionParts(facts: TurnFacts): InstructionParts {
  const writing = phaseOf(facts.state) === 'planning' ? [] : [panelGuideFor(facts)];
  const catalog = `Connectors and their data (the catalog):\n${facts.catalog}`;
  return {
    lasting: [persona, generalRules, ...writing, catalog].join('\n\n'),
    turn: situation(facts),
  };
}

/**
 * The instructions of a turn as one text.
 *
 * @param facts - The facts of the turn.
 * @returns The system instructions.
 */
export function instructionsFor(facts: TurnFacts): string {
  const { lasting, turn } = instructionParts(facts);
  return `${lasting}\n\n${turn}`;
}
