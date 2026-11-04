/**
 * The thread's draft as the agent's tools read it: the latest version of its dashboard.
 */
import { type DashboardSpec, dashboardSpecSchema } from '@quanthea/shared';
import type { RunContext } from './run-context.ts';

/**
 * The thread's latest dashboard version, if it has one.
 *
 * @param context - The run.
 * @returns The spec.
 */
export function currentSpec(
  context: Pick<RunContext, 'threads' | 'threadId' | 'dashboards'>,
): DashboardSpec | undefined {
  const { dashboardId } = context.threads.row(context.threadId);
  if (dashboardId === null) return undefined;
  const latest = context.dashboards.get(dashboardId, 'editor').versions.at(-1)?.version;
  if (latest === undefined) return undefined;
  return dashboardSpecSchema.parse(
    context.dashboards.getVersion(dashboardId, latest, 'editor').spec,
  );
}
