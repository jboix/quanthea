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
 * @returns Such as `Not saved · the agent fixes it, try 1 of 3`, or, when the tries ran out, `I
 *   could not build this after 3 tries`.
 */
export function repairTitle(repair: Repair): string {
  const { attempt, of, outcome, panels } = repair;
  if (outcome === 'repaired')
    return `Fixed after ${counted(attempt, 'failed try', 'failed tries')}`;
  if (outcome === 'exhausted')
    return `I could not build this after ${counted(attempt, 'try', 'tries')}`;
  const tries = `the agent fixes it, try ${attempt} of ${of}`;
  if (outcome === 'left-out')
    return `Saved without ${counted(panels.length, 'panel', 'panels')} · ${tries}`;
  return `Not saved · ${tries}`;
}

/**
 * What still fails once a build stopped, in a sentence: the failing panels by title, or the
 * dashboard as a whole.
 *
 * @param repair - The try that stopped the build.
 * @returns Such as `Orders per channel and Deploys still fail.`
 */
export function stillFailing(repair: Repair): string {
  const titles = repair.panels.map((panel) => panel.title);
  if (titles.length === 0) return 'The dashboard as a whole still has a problem.';
  const shown = titles.length > 3 ? [...titles.slice(0, 2), `${titles.length - 2} more`] : titles;
  const list =
    shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`;
  return `${list} still ${titles.length === 1 ? 'fails' : 'fail'}.`;
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
