/**
 * How the MCP tools read dashboards. A tool sees what every signed-in person sees: the pinned
 * version of a pinned dashboard, through its layout, with the hidden panels left out. Drafts
 * never show, whatever the token's role.
 */
import {
  allValue,
  applyLayout,
  type DashboardSpec,
  type Panel,
  variableDefault,
  variableSource,
} from '@quanthea/shared';
import { levelOf, linkTo, type McpServices } from './services.ts';
import { ToolRefusal } from './tool.ts';

/** A pinned dashboard as shown. */
export interface PinnedDashboard {
  /** The dashboard id. */
  readonly id: string;
  /** Its description, written when it was pinned. */
  readonly description: string | null;
  /** Its tags. */
  readonly tags: readonly string[];
  /** The pinned version. */
  readonly version: number;
  /** The pinned version's spec, as shown. */
  readonly spec: DashboardSpec;
}

/**
 * Reads a pinned dashboard as a viewer sees it.
 *
 * @param services - The MCP services.
 * @param dashboardId - The dashboard.
 * @returns The dashboard and its spec as shown.
 * @throws {AppError} `not_found` for an unknown dashboard or one that is not pinned.
 */
export function pinnedDashboard(services: McpServices, dashboardId: string): PinnedDashboard {
  const detail = services.dashboards.get(dashboardId, 'viewer');
  const version = detail.pinnedVersion ?? 0;
  const shown = services.dashboards.getVersion(dashboardId, version, 'viewer');
  const { spec } = applyLayout(shown.spec, shown.layout?.layout);
  return { id: detail.id, description: detail.description, tags: detail.tags, version, spec };
}

/**
 * A panel of a spec.
 *
 * @param spec - The spec as shown.
 * @param panelId - The panel.
 * @returns The panel.
 * @throws {ToolRefusal} For an unknown panel, naming the panels there are.
 */
export function panelOf(spec: Pick<DashboardSpec, 'panels'>, panelId: string): Panel {
  const panel = spec.panels.find((candidate) => candidate.id === panelId);
  if (panel) return panel;
  const ids = spec.panels.map((candidate) => candidate.id).join(', ');
  throw new ToolRefusal(`There is no panel "${panelId}". Panels: ${ids}.`);
}

/**
 * The link that opens a dashboard in quanthea.
 *
 * @param services - The MCP services.
 * @param dashboardId - The dashboard.
 * @returns The URL, or the path when quanthea has no public URL.
 */
export function dashboardUrl(services: McpServices, dashboardId: string): string {
  return linkTo(services, 'd', dashboardId);
}

/** The access level from which a connector's values show. */
const valuesLevel = 3;

/**
 * A variable's default as a tool may show it. A default written for a variable whose values come
 * from a connector is one of that connector's values, so it shows from the level that shows
 * values; "all" always shows.
 *
 * @param services - The MCP services.
 * @param variable - The variable.
 * @returns The default, or `undefined` when there is none or its level hides it.
 */
export function shownDefault(
  services: McpServices,
  variable: DashboardSpec['variables'][number],
): string | readonly string[] | undefined {
  const value = variableDefault(variable);
  const source = variableSource(variable);
  if (value === undefined || !source || [value].flat().includes(allValue)) return value;
  return (levelOf(services, source.connector) ?? 0) >= valuesLevel ? value : undefined;
}
