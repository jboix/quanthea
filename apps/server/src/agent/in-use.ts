/**
 * The connectors a thread's work is about once it writes: those its approved plan names and those
 * its draft reads. A run offers the builders, the guide and the variable sources of these
 * connectors only, so a thread on two sources does not carry the forms of every source connected.
 * Providers refuse a forced tool call whose schema grows too large, and a shorter guide keeps the
 * model on what it builds.
 */
import type { ModelConnector } from '../gate/model-view.ts';
import { currentSpec } from './build-tools.ts';
import { phaseOf } from './phases.ts';
import { currentReport } from './report-edit.ts';
import type { RunContext } from './run-context.ts';

/** What the connectors in use are read from: the services, and the thread. */
type InUseContext = Pick<
  RunContext,
  'threads' | 'threadId' | 'dashboards' | 'reports' | 'modelView'
>;

/**
 * Adds the names a field gives: a `connector`, or a list of `connectors`.
 *
 * @param key - The field's name.
 * @param value - The field's value.
 * @param names - The names found so far.
 * @returns Whether the field named connectors.
 */
function named(key: string, value: unknown, names: Set<string>): boolean {
  if (key === 'connector' && typeof value === 'string') return names.add(value).has(value);
  if (key !== 'connectors' || !Array.isArray(value)) return false;
  for (const each of value) if (typeof each === 'string') names.add(each);
  return true;
}

/**
 * Collects the connectors a plan or a spec names, at any depth.
 *
 * @param value - A plan, a spec, or a value inside one.
 * @param names - The names found so far.
 */
function collect(value: unknown, names: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collect(item, names);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, item] of Object.entries(value)) {
    if (!named(key, item, names)) collect(item, names);
  }
}

/**
 * The connectors a run's tools and guide are about. Every connector while the thread plans, in an
 * alert thread, and when the plan and the draft name none that is connected.
 *
 * @param context - The services and the thread.
 * @param plans - The thread's plans, the latest last.
 * @returns The connectors in use.
 */
export function connectorsInUse(
  context: InUseContext,
  plans: readonly { readonly body: unknown; readonly status: string }[],
): ModelConnector[] {
  const all = context.modelView.connectors();
  const { state, kind } = context.threads.row(context.threadId);
  if (kind === 'alert' || kind === 'definition' || phaseOf(state) === 'planning') return all;
  const names = new Set<string>();
  const plan = plans.at(-1);
  if (plan?.status === 'approved') collect(plan.body, names);
  collect(kind === 'report' ? currentReport(context)?.spec : currentSpec(context), names);
  const used = all.filter((connector) => names.has(connector.name));
  return used.length === 0 ? all : used;
}
