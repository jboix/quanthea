/**
 * What a run offers of the connectors it is about (in-use.ts finds them): their query languages
 * and their query guides.
 */
import type { ModelConnector } from '../gate/model-view.ts';
import type { RunContext } from './run-context.ts';

/**
 * The query languages of the connectors a run is about.
 *
 * @param context - The run.
 * @returns The languages, each once.
 */
export function languagesInUse(context: Pick<RunContext, 'inUse'>): ModelConnector['language'][] {
  return [...new Set(context.inUse.map((connector) => connector.language))];
}

/**
 * The query guides of the connector kinds a run is about.
 *
 * @param context - The run.
 * @returns The guides the instructions name.
 */
export function guidesInUse(context: Pick<RunContext, 'inUse' | 'modelView'>) {
  const kinds = new Set(context.inUse.map((connector) => connector.kind));
  return context.modelView.guides().filter((guide) => kinds.has(guide.kind));
}
