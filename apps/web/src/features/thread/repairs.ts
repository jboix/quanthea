/**
 * The repair loop as the thread shows it: what each try's card says, and whether the latest answer
 * stopped with failures left.
 */
import type { Repair } from '@quanthea/shared';
import type { ThreadMessage } from './messages.ts';

/**
 * A count with its noun, such as `1 panel` or `2 panels`.
 *
 * @param count - The count.
 * @param one - The noun, singular.
 * @param many - The noun, plural.
 * @returns The phrase.
 */
function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The heading of a repair card.
 *
 * @param repair - The try.
 * @returns Such as `Not saved · the agent fixes it, try 1 of 3`.
 */
export function repairTitle(repair: Repair): string {
  const { attempt, of, outcome, panels } = repair;
  if (outcome === 'repaired')
    return `Fixed after ${counted(attempt, 'failed try', 'failed tries')}`;
  if (outcome === 'exhausted')
    return `Stopped after ${counted(attempt, 'failed try', 'failed tries')}`;
  const tries = `the agent fixes it, try ${attempt} of ${of}`;
  if (outcome === 'left-out')
    return `Saved without ${counted(panels.length, 'panel', 'panels')} · ${tries}`;
  return `Not saved · ${tries}`;
}

/**
 * The last repair of the latest answer, if it has one.
 *
 * @param messages - The conversation.
 * @returns The repair's data.
 */
export function lastRepair(messages: readonly ThreadMessage[]): Repair | undefined {
  const answer = messages.at(-1);
  if (answer?.role !== 'assistant') return undefined;
  const repairs = answer.parts.flatMap((part) => (part.type === 'data-repair' ? [part.data] : []));
  return repairs.at(-1);
}

/**
 * Whether the latest answer stopped with panels that still fail.
 *
 * @param messages - The conversation.
 * @returns Whether the build stopped.
 */
export function buildStopped(messages: readonly ThreadMessage[]): boolean {
  return lastRepair(messages)?.outcome === 'exhausted';
}
