/**
 * The tools that find and read pinned dashboards: a search, a dashboard's summary, and one panel
 * as written. They return what a dashboard says, never data: a panel's data comes from
 * `run_panel`, through the gate.
 */
import type { DashboardSpec, Panel } from '@quanthea/shared';
import { z } from 'zod';
import { dashboardUrl, panelOf, pinnedDashboard, shownDefault } from './pinned.ts';
import type { McpServices } from './services.ts';
import { defineTool, type McpTool } from './tool.ts';

/** The most dashboards a search returns. */
const maximumResults = 25;

/** Validates a dashboard id. */
const dashboardIdSchema = z.string().min(1).max(64).describe('A dashboard id.');

/**
 * The tool that searches the pinned dashboards.
 *
 * @param services - The MCP services.
 * @returns The tool.
 */
function searchTool(services: McpServices): McpTool {
  return defineTool({
    name: 'search_dashboards',
    title: 'Search dashboards',
    description:
      'Search the pinned dashboards by words in their titles, descriptions, tags, panels and queries. Every word must match. Without a query, lists them all, the most recently changed first. Returns at most 25, each with its id for get_dashboard.',
    minimumRole: 'viewer',
    group: 'read',
    input: z.object({
      query: z.string().max(200).optional().describe('Words to look for.'),
      tags: z.array(z.string().max(60)).max(10).optional().describe('Tags it must all have.'),
      connectors: z.array(z.string().max(100)).max(10).optional().describe('Connectors it reads.'),
    }),
    run: ({ query, tags = [], connectors = [] }) => {
      const { results } = services.dashboards.searchLibrary({ q: query, tags, connectors });
      const dashboards = results.slice(0, maximumResults).map((entry) => ({
        id: entry.dashboardId,
        title: entry.title,
        description: entry.description,
        tags: entry.tags,
        connectors: entry.connectors,
        panelCount: entry.panelCount,
        matchingPanels: entry.panels.map(({ id, title }) => ({ id, title })),
        url: dashboardUrl(services, entry.dashboardId),
      }));
      return { dashboards, total: results.length };
    },
  });
}

/**
 * A panel in a dashboard's summary: what it is and where its data comes from.
 *
 * @param panel - The panel.
 * @returns The summary line.
 */
function panelSummary(panel: Panel) {
  return {
    id: panel.id,
    title: panel.title,
    ...(panel.description === undefined ? {} : { description: panel.description }),
    view: panel.view.kind,
    connectors: [...new Set(panel.queries.map((query) => query.connector))],
    ...(panel.definition === undefined ? {} : { definition: panel.definition.id }),
  };
}

/**
 * The variables of a spec, each with its default where its level shows it.
 *
 * @param services - The MCP services.
 * @param spec - The spec.
 * @returns The variables.
 */
function variableSummaries(services: McpServices, spec: DashboardSpec) {
  return spec.variables.map((variable) => {
    const value = shownDefault(services, variable);
    return {
      name: variable.name,
      kind: variable.kind,
      ...(value === undefined ? {} : { default: value }),
    };
  });
}

/**
 * The tool that reads a dashboard's summary.
 *
 * @param services - The MCP services.
 * @returns The tool.
 */
function dashboardTool(services: McpServices): McpTool {
  return defineTool({
    name: 'get_dashboard',
    title: 'Read a dashboard',
    description:
      "Read a pinned dashboard's summary: its description, default time range, variables with their defaults, and each panel's id, title, view and connectors. Use get_panel for a panel's queries and run_panel for its data.",
    minimumRole: 'viewer',
    group: 'read',
    input: z.object({ dashboardId: dashboardIdSchema }),
    run: ({ dashboardId }) => {
      const { id, description, tags, version, spec } = pinnedDashboard(services, dashboardId);
      return {
        id,
        title: spec.title,
        description,
        tags,
        version,
        timeZone: spec.timezone ?? null,
        time: spec.time,
        variables: variableSummaries(services, spec),
        panels: spec.panels.map(panelSummary),
        url: dashboardUrl(services, id),
      };
    },
  });
}

/**
 * The tool that reads one panel as written.
 *
 * @param services - The MCP services.
 * @returns The tool.
 */
function panelTool(services: McpServices): McpTool {
  return defineTool({
    name: 'get_panel',
    title: 'Read a panel',
    description:
      'Read one panel of a pinned dashboard as written: its queries, the operations on their tables, its view, and the definition it was built from. It holds no data.',
    minimumRole: 'viewer',
    group: 'read',
    input: z.object({
      dashboardId: dashboardIdSchema,
      panelId: z.string().min(1).max(100).describe('A panel id, from get_dashboard.'),
    }),
    run: ({ dashboardId, panelId }) => {
      const { id, version, spec } = pinnedDashboard(services, dashboardId);
      const { grid: _grid, ...panel } = panelOf(spec, panelId);
      return { dashboardId: id, version, panel, url: dashboardUrl(services, id) };
    },
  });
}

/**
 * The tools that find and read pinned dashboards.
 *
 * @param services - The MCP services.
 * @returns The tools.
 */
export function dashboardTools(services: McpServices): McpTool[] {
  return [searchTool(services), dashboardTool(services), panelTool(services)];
}
