/**
 * The one line that stands for the agent's work in a turn (its explore calls, writes and failed
 * tries), folded like a chatbot's thinking: what it is doing while it works, what it did after.
 */
import type { Repair } from '@quanthea/shared';
import { buildTools, exploreTools, isToolPart, type ThreadPart, toolName } from './messages.ts';

/** How the work went: still going, fixing a failure, done, or done after fixing one. */
export type WorkState = 'working' | 'fixing' | 'done' | 'fixed';

/** The folded line: its words and its state. */
export interface WorkSummary {
  readonly text: string;
  readonly state: WorkState;
}

/**
 * Whether a part is the agent's work, folded into the line: an explore call, a write, or a
 * failed try the agent still fixes. A try that stopped the turn stays in view.
 *
 * @param part - The part.
 * @returns Whether it folds.
 */
export function isWorkPart(part: ThreadPart): boolean {
  if (part.type === 'data-repair') return part.data.outcome !== 'exhausted';
  if (!isToolPart(part)) return false;
  const name = toolName(part);
  return exploreTools.has(name) || buildTools.has(name);
}

/**
 * A count with its noun, such as `1 step` or `3 steps`.
 *
 * @param count - The count.
 * @param noun - The noun, singular; the plural adds an s.
 * @returns The phrase.
 */
function counted(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

/**
 * What the agent is doing now, from the last part of its work.
 *
 * @param parts - The work parts, in order.
 * @param repair - The last try that failed or was fixed, if any.
 * @returns The line.
 */
function workingSummary(parts: readonly ThreadPart[], repair: Repair | undefined): WorkSummary {
  if (repair && repair.outcome !== 'repaired')
    return { text: 'Fixing a problem with a query…', state: 'fixing' };
  const last = parts.flatMap((part) => (isToolPart(part) ? [part] : [])).at(-1);
  const building = last !== undefined && buildTools.has(toolName(last));
  return { text: building ? 'Building…' : 'Looking at the data…', state: 'working' };
}

/**
 * The versions the work saved, in order.
 *
 * @param parts - The work parts.
 * @returns The version numbers.
 */
function savedVersions(parts: readonly ThreadPart[]): number[] {
  return parts.flatMap((part) => {
    if (!isToolPart(part) || !buildTools.has(toolName(part))) return [];
    const output = (part.output ?? {}) as { ok?: boolean; version?: number };
    return output.ok && output.version !== undefined ? [output.version] : [];
  });
}

/**
 * What the agent did, once it is done.
 *
 * @param parts - The work parts, in order.
 * @param repair - The last try that failed or was fixed, if any.
 * @returns The line.
 */
function doneSummary(parts: readonly ThreadPart[], repair: Repair | undefined): WorkSummary {
  const explored = parts.filter((part) => isToolPart(part) && exploreTools.has(toolName(part)));
  const writes = parts.filter((part) => isToolPart(part) && buildTools.has(toolName(part)));
  const version = savedVersions(parts).at(-1);
  const built =
    version === undefined ? `tried ${counted(writes.length, 'time')}` : `built v${version}`;
  const pieces = [
    explored.length > 0 ? `Explored ${counted(explored.length, 'step')}` : '',
    writes.length > 0 ? built : '',
    repair?.outcome === 'repaired' ? `fixed after ${counted(repair.attempt, 'failed try')}` : '',
  ].filter((piece) => piece !== '');
  const text = pieces.join(' · ') || 'Worked';
  const sentence = text.charAt(0).toUpperCase() + text.slice(1);
  return { text: sentence, state: repair?.outcome === 'repaired' ? 'fixed' : 'done' };
}

/**
 * The folded line of some work.
 *
 * @param parts - The work parts, in order.
 * @param live - Whether the agent is still at it: the work ends the turn that is running.
 * @returns Its words and state.
 */
export function workSummary(parts: readonly ThreadPart[], live: boolean): WorkSummary {
  const repairs = parts.flatMap((part) => (part.type === 'data-repair' ? [part.data] : []));
  const repair = repairs.at(-1);
  return live ? workingSummary(parts, repair) : doneSummary(parts, repair);
}
