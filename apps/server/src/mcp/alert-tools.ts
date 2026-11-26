/**
 * The tools that read alerts: the active ones as written, and one alert with its state. An
 * alert's state is data, so it passes through the gate: level 1 shows nothing of it, level 2 how
 * many series there are and their label names, level 3 and 4 the labels, the values and whether
 * the condition holds. A ratio of two connectors reads at the weaker level.
 */
import type { AlertDetail, AlertListItem, AlertSpec } from '@quanthea/shared';
import { z } from 'zod';
import { linkTo, type McpServices } from './services.ts';
import { defineTool, type McpTool, ToolRefusal } from './tool.ts';

/** An alert as the service returns it to a reader. */
type ReadAlert = Omit<AlertDetail, 'canChange'>;

/**
 * An alert as written, with no state: what a list shows of it.
 *
 * @param services - The MCP services.
 * @param alert - The alert.
 * @returns Its title, severity, condition and whether it is evaluated.
 */
function writtenAlert(services: McpServices, alert: AlertListItem) {
  return {
    id: alert.id,
    title: alert.title,
    severity: alert.severity,
    condition: alert.condition,
    deactivated: alert.deactivated,
    muted: alert.muted !== null,
    evaluatedAt: alert.evaluatedAt === null ? null : new Date(alert.evaluatedAt).toISOString(),
    url: linkTo(services, 'alerts', alert.id),
  };
}

/**
 * The tool that lists the active alerts.
 *
 * @param services - The MCP services.
 * @returns The tool.
 */
function listTool(services: McpServices): McpTool {
  return defineTool({
    name: 'list_alerts',
    title: 'List alerts',
    description:
      'List the active alerts as written: title, severity, condition, whether evaluation is stopped or muted, and when each was last evaluated. Use get_alert for an alert’s query and its state.',
    minimumRole: 'viewer',
    group: 'read',
    input: z.object({}),
    run: () => {
      const active = services.alerts.list('viewer').filter((alert) => alert.activeVersion !== null);
      return { alerts: active.map((alert) => writtenAlert(services, alert)) };
    },
  });
}

/**
 * The spec an alert is evaluated with.
 *
 * @param alert - The alert.
 * @returns The spec of its active version.
 * @throws {ToolRefusal} For an alert that is not active.
 */
function activeSpec(alert: ReadAlert): AlertSpec {
  const active = alert.versions.find((version) => version.version === alert.activeVersion);
  if (!active) throw new ToolRefusal(`Alert ${alert.id} is not active.`);
  return active.spec;
}

/**
 * The connectors an alert's queries run on: one, or two for a ratio.
 *
 * @param spec - The alert's spec.
 * @returns Their names, each once.
 */
function connectorsOf(spec: Pick<AlertSpec, 'query' | 'dividedBy'>): string[] {
  const names = [spec.query.connector, ...(spec.dividedBy ? [spec.dividedBy.query.connector] : [])];
  return [...new Set(names)];
}

/**
 * An alert's state at its last evaluation, as the gate lets it through. The count of series in
 * each state shows from level 3, where the gate shows which series hold.
 *
 * @param services - The MCP services.
 * @param alert - The alert.
 * @param connectors - The connectors its queries run on.
 * @returns What the weaker access level shows, or why nothing shows.
 */
function stateOf(services: McpServices, alert: ReadAlert, connectors: readonly string[]) {
  const series = alert.series.map((each) => ({
    labels: each.labels,
    value: each.value,
    holds: each.state === 'firing' || each.state === 'pending',
  }));
  const check = services.modelView.alertCheck(connectors, series);
  if (!('level' in check) || check.level < 3) return check;
  return { ...check, states: alert.states };
}

/**
 * The tool that reads one alert.
 *
 * @param services - The MCP services.
 * @returns The tool.
 */
function alertTool(services: McpServices): McpTool {
  return defineTool({
    name: 'get_alert',
    title: 'Read an alert',
    description:
      "Read one active alert: its query, condition and timing as written, and its state at the last evaluation. What the state shows follows the access level of the alert's connector: 1 nothing, 2 how many series and their label names, 3 and 4 each series' labels, value and whether the condition holds (`holds` is true for a series that is pending or firing), with the count of series in each state.",
    minimumRole: 'viewer',
    group: 'read',
    input: z.object({ alertId: z.string().min(1).max(64).describe('An alert id.') }),
    run: ({ alertId }) => {
      const alert = services.alerts.get(alertId, 'viewer');
      const { notify: _notify, ...spec } = activeSpec(alert);
      const connectors = connectorsOf(spec);
      return {
        ...writtenAlert(services, alert),
        version: alert.activeVersion,
        spec,
        connectors,
        state: stateOf(services, alert, connectors),
      };
    },
  });
}

/**
 * The tools that read alerts.
 *
 * @param services - The MCP services.
 * @returns The tools.
 */
export function alertTools(services: McpServices): McpTool[] {
  return [listTool(services), alertTool(services)];
}
