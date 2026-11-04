/**
 * The check before a build: the model plans from the schema the catalog cached, which reads the
 * same when a connector is down. So a building run first checks the connectors it builds on, and
 * when one does not answer the thread shows a card instead of building, with no model call.
 */
import type { RunContext } from './run-context.ts';

/** How long a connector has to answer the check. */
const reachTimeoutMs = 10_000;

/**
 * The connectors a building dashboard run reads that do not answer now.
 *
 * @param context - The run.
 * @returns Their names; none outside a build, or when every one answers.
 */
export async function unreachableConnectors(context: RunContext): Promise<string[]> {
  const { state, kind } = context.threads.row(context.threadId);
  if (kind !== 'dashboard' || state !== 'building') return [];
  const signal = AbortSignal.any([context.signal, AbortSignal.timeout(reachTimeoutMs)]);
  const names = context.inUse.map((connector) => connector.name);
  const reached = await Promise.all(names.map((name) => context.modelView.reach(name, signal)));
  return names.filter((_name, index) => !reached[index]);
}

/** The id of the card, the same on every try, so Try again replaces the card in the answer. */
const cardId = 'unreachable';

/**
 * Writes the answer of a run that does not build: the card of the connectors that do not answer.
 * A try that finds them down again continues the same answer and replaces its card.
 *
 * @param context - The run.
 * @param names - The connectors that do not answer.
 */
export function writeUnreachable(context: RunContext, names: readonly string[]): void {
  const data = { connectors: [...names] };
  context.writer.write({ type: 'start' });
  context.writer.write({ type: 'data-unreachable', id: cardId, data });
  context.writer.write({ type: 'finish' });
}
