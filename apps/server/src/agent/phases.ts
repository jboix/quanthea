/**
 * The phases of a thread as the agent sees them, and what each gives the model: planning talks
 * and plans, building writes the approved plan, editing refines the built dashboard or alert.
 * Each phase offers only the tools it needs, so every request carries fewer tool definitions. A
 * dashboard thread and an alert thread have tools of their own.
 */
import type { ThreadState } from '../threads/state.ts';

/** A phase. */
export type Phase = 'planning' | 'building' | 'editing';

/** The agent's tools, by name. */
export type ToolName =
  | 'describe'
  | 'sample_values'
  | 'test_query'
  | 'ask_person'
  | 'propose_plan'
  | 'edit_dashboard'
  | 'chart_recipe'
  | 'read_guide'
  | 'propose_alert'
  | 'edit_alert'
  | 'replay_alert'
  | 'propose_link';

/** The tools each phase offers. */
export const phaseTools: Readonly<Record<Phase, readonly ToolName[]>> = {
  planning: ['describe', 'sample_values', 'ask_person', 'propose_plan'],
  building: [
    'describe',
    'sample_values',
    'read_guide',
    'test_query',
    'chart_recipe',
    'edit_dashboard',
  ],
  editing: [
    'describe',
    'sample_values',
    'read_guide',
    'test_query',
    'ask_person',
    'propose_plan',
    'chart_recipe',
    'edit_dashboard',
  ],
};

/**
 * The tools each phase offers in an alert thread: planning describes the data and proposes what
 * to watch; building and editing test queries, read the alert guide and write the alert, and
 * replay it where the access level shows numbers. Once written, the agent may propose showing it
 * on a dashboard panel whose query matches.
 */
export const alertPhaseTools: Readonly<Record<Phase, readonly ToolName[]>> = {
  planning: ['describe', 'sample_values', 'ask_person', 'propose_alert'],
  building: [
    'describe',
    'sample_values',
    'read_guide',
    'test_query',
    'edit_alert',
    'replay_alert',
    'propose_link',
  ],
  editing: [
    'describe',
    'sample_values',
    'read_guide',
    'test_query',
    'ask_person',
    'propose_alert',
    'edit_alert',
    'replay_alert',
    'propose_link',
  ],
};

/**
 * The phase of a thread state.
 *
 * @param state - The thread state.
 * @returns Planning before approval, building after, editing once built.
 */
export function phaseOf(state: ThreadState): Phase {
  if (state === 'building') return 'building';
  if (state === 'ready') return 'editing';
  return 'planning';
}
