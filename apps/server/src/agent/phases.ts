/**
 * The phases of a thread as the agent sees them, and what each gives the model: planning talks
 * and plans, building writes the approved plan, editing refines the built dashboard. Each phase
 * offers only the tools it needs, so every request carries fewer tool definitions.
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
  | 'write_dashboard'
  | 'patch_panel';

/** The tools each phase offers. */
export const phaseTools: Readonly<Record<Phase, readonly ToolName[]>> = {
  planning: ['describe', 'sample_values', 'ask_person', 'propose_plan'],
  building: ['describe', 'sample_values', 'test_query', 'write_dashboard'],
  editing: [
    'describe',
    'sample_values',
    'test_query',
    'ask_person',
    'propose_plan',
    'write_dashboard',
    'patch_panel',
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
