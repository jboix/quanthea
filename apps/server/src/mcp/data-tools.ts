/**
 * The tools that read a pinned dashboard's data: a panel's queries, and the values a variable
 * offers. Each query runs through the gate, so a result shows what the access level of its
 * connector allows: level 1 whether it ran, level 2 the shape, level 3 summaries, level 4 rows.
 * Variables are bound as a panel run binds them, never pasted into a query.
 */
import {
  type DashboardSpec,
  isChosen,
  type Panel,
  type QueryTemplate,
  resolveTimeRange,
  timeRangeSchema,
  type VariableValues,
  variableSource,
  variableValuesSchema,
} from '@quanthea/shared';
import { z } from 'zod';
import type { Dashboards } from '../dashboards/dashboards.ts';
import {
  dashboardUrl,
  type PinnedDashboard,
  panelOf,
  pinnedDashboard,
  shownDefault,
} from './pinned.ts';
import { levelOf, type McpServices } from './services.ts';
import { defineTool, type McpTool, ToolRefusal } from './tool.ts';

/** The variables of a read, bound as panels bind them. */
type Bindings = Awaited<ReturnType<Dashboards['bindVariables']>>;

/** The choices a read is made with: the variables' values and the time range. */
const choices = {
  dashboardId: z.string().min(1).max(64).describe('A dashboard id.'),
  variables: variableValuesSchema
    .optional()
    .describe("Values by variable name; a variable left out takes the dashboard's default."),
  time: timeRangeSchema
    .optional()
    .describe(
      'The time range: `now`, `now-7d` or ISO 8601 times with an offset. The default is the range the dashboard opens with.',
    ),
};

/** Validates the choices of a read. */
const choicesSchema = z.object(choices);

/** A pinned dashboard with the choices of one read resolved. */
interface Prepared {
  /** The dashboard as shown. */
  readonly pinned: PinnedDashboard;
  /** The time range, as instants. */
  readonly timeRange: { readonly from: Date; readonly to: Date };
  /** The time zone the gate profiles numbers in. */
  readonly timeZone: string;
  /** The variables, bound. They hold values read from connectors, so no result carries them. */
  readonly bindings: Bindings;
  /** The value each variable was given: the caller's, else the default the dashboard writes. */
  readonly chosen: VariableValues;
  /** Aborted when the client goes away. */
  readonly signal: AbortSignal;
}

/**
 * Resolves the choices of a read against a pinned dashboard.
 *
 * @param services - The MCP services.
 * @param input - The dashboard, the variables and the time range.
 * @param signal - Aborted when the client goes away.
 * @returns The dashboard with the time range and the bound variables.
 * @throws {ToolRefusal} For a time range that ends before it starts.
 */
async function prepare(
  services: McpServices,
  input: z.output<typeof choicesSchema>,
  signal: AbortSignal,
): Promise<Prepared> {
  const pinned = pinnedDashboard(services, input.dashboardId);
  const now = (services.now ?? Date.now)();
  const { from, to } = resolveTimeRange(input.time ?? pinned.spec.time, now);
  if (!(from < to)) throw new ToolRefusal('The time range ends before it starts.');
  const timeRange = { from: new Date(from), to: new Date(to) };
  const time = { from: timeRange.from.toISOString(), to: timeRange.to.toISOString() };
  const picked = { variables: input.variables ?? {}, time };
  const bindings = await services.dashboards.bindVariables(pinned.spec, picked, signal);
  const chosen = chosenValues(services, pinned.spec, picked.variables);
  const timeZone = pinned.spec.timezone ?? 'UTC';
  return { pinned, timeRange, timeZone, bindings, chosen, signal };
}

/**
 * The value each variable of a read was given, as a result records it: the caller's own choice,
 * else the default written in the dashboard, where its level shows it. Never the bound values: a
 * choice such as "all" binds to values read from a connector, and those are data.
 *
 * @param services - The MCP services.
 * @param spec - The spec.
 * @param picked - The caller's choices.
 * @returns The values by variable name.
 */
function chosenValues(
  services: McpServices,
  spec: DashboardSpec,
  picked: VariableValues,
): VariableValues {
  const entries = spec.variables.filter(isChosen).flatMap((variable) => {
    const value = picked[variable.name] ?? shownDefault(services, variable);
    if (value === undefined) return [];
    return [[variable.name, typeof value === 'string' ? value : [...value]] as const];
  });
  return Object.fromEntries(entries);
}

/**
 * How a read was made, for its result to say: the dashboard, the range and the variables.
 *
 * @param services - The MCP services.
 * @param prepared - The read.
 * @returns The facts every result of a read carries.
 */
function provenance(services: McpServices, prepared: Prepared) {
  const { pinned, timeRange, timeZone, chosen } = prepared;
  return {
    dashboardId: pinned.id,
    version: pinned.version,
    time: { from: timeRange.from.toISOString(), to: timeRange.to.toISOString() },
    timeZone,
    variables: chosen,
    url: dashboardUrl(services, pinned.id),
  };
}

/**
 * The request the gate runs for one query of a read.
 *
 * @param prepared - The read.
 * @param refId - The name of the result.
 * @param template - The query.
 * @returns The request.
 */
function requestOf(prepared: Prepared, refId: string, template: QueryTemplate) {
  const { bindings, timeRange, signal } = prepared;
  return { refId, template, variables: bindings, timeRange, signal };
}

/**
 * Runs one query through the gate.
 *
 * @param services - The MCP services.
 * @param prepared - The read.
 * @param query - The query, with the name of its result.
 * @returns The query, the level it was read at, and what the gate lets through.
 */
async function readQuery(
  services: McpServices,
  prepared: Prepared,
  query: QueryTemplate & { readonly refId: string },
) {
  const { connector, refId } = query;
  const request = requestOf(prepared, refId, query);
  const result = await services.modelView.testQuery(connector, request, prepared.timeZone);
  return { refId, connector, accessLevel: levelOf(services, connector), query, result };
}

/**
 * Reads the table a panel's operations make, each connector's part at its own level.
 *
 * @param services - The MCP services.
 * @param prepared - The read.
 * @param panel - A panel with operations.
 * @returns The queries, the operations, and what the gate lets through of their table.
 */
async function readDerived(services: McpServices, prepared: Prepared, panel: Panel) {
  const operations = panel.operations ?? [];
  const reads = panel.queries.map((query) => ({
    connector: query.connector,
    request: requestOf(prepared, query.refId, query),
  }));
  const connectors = [...new Set(panel.queries.map((query) => query.connector))];
  return {
    refId: panel.queries[0]?.refId ?? '',
    connectors: connectors.map((name) => ({ name, accessLevel: levelOf(services, name) })),
    queries: panel.queries,
    operations,
    result: await services.modelView.readOperations(reads, operations, prepared.timeZone),
  };
}

/**
 * Reads a panel: the table its operations make, or each of its queries, or the one asked for.
 *
 * @param services - The MCP services.
 * @param prepared - The read.
 * @param panel - The panel.
 * @param refId - One of its queries, to read that one alone as written.
 * @returns One result per table read.
 * @throws {ToolRefusal} For a query the panel does not have.
 */
function readPanel(services: McpServices, prepared: Prepared, panel: Panel, refId?: string) {
  if (refId === undefined && panel.operations)
    return readDerived(services, prepared, panel).then((derived) => [derived]);
  const queries = panel.queries.filter((query) => refId === undefined || query.refId === refId);
  if (queries.length === 0) throw new ToolRefusal(`Panel "${panel.id}" has no query "${refId}".`);
  return Promise.all(queries.map((query) => readQuery(services, prepared, query)));
}

/**
 * The tool that reads a panel's data.
 *
 * @param services - The MCP services.
 * @returns The tool.
 */
function runPanelTool(services: McpServices): McpTool {
  return defineTool({
    name: 'run_panel',
    title: 'Read a panel’s data',
    description:
      'Run the queries of one panel of a pinned dashboard and return their results, with the query, the time range and the variables each was made with. What a result shows follows the access level of its connector: 1 whether the query ran, 2 the shape (fields, types, row counts), 3 a summary of each field, 4 the rows (at most 500). A panel with operations returns the table they make; pass refId to read one of its queries as written.',
    minimumRole: 'viewer',
    group: 'read',
    input: choicesSchema.extend({
      panelId: z.string().min(1).max(100).describe('A panel id, from get_dashboard.'),
      refId: z.string().max(20).optional().describe('One of its queries; all of them by default.'),
    }),
    run: async (input, { signal }) => {
      const prepared = await prepare(services, input, signal);
      const panel = panelOf(prepared.pinned.spec, input.panelId);
      const results = await readPanel(services, prepared, panel, input.refId);
      return {
        ...provenance(services, prepared),
        panel: { id: panel.id, title: panel.title },
        results,
      };
    },
  });
}

/**
 * A variable of a spec.
 *
 * @param spec - The spec.
 * @param name - The variable's name.
 * @returns The variable.
 * @throws {ToolRefusal} For an unknown variable, naming the variables there are.
 */
function variableOf(spec: DashboardSpec, name: string) {
  const variable = spec.variables.find((candidate) => candidate.name === name);
  if (variable) return variable;
  const names = spec.variables.map((candidate) => candidate.name).join(', ') || 'none';
  throw new ToolRefusal(`The dashboard has no variable "${name}". Variables: ${names}.`);
}

/**
 * The tool that reads the values a variable offers.
 *
 * @param services - The MCP services.
 * @returns The tool.
 */
function variableOptionsTool(services: McpServices): McpTool {
  return defineTool({
    name: 'get_variable_options',
    title: 'Read a variable’s values',
    description:
      "Read the values a dashboard's variable offers. A list written in the dashboard is returned as written. Values that come from a query are read through the gate, so what shows follows the access level of the query's connector.",
    minimumRole: 'viewer',
    group: 'read',
    input: choicesSchema.extend({
      name: z.string().min(1).max(100).describe("A variable's name, from get_dashboard."),
    }),
    run: async (input, { signal }) => {
      const prepared = await prepare(services, input, signal);
      const variable = variableOf(prepared.pinned.spec, input.name);
      const shown = shownDefault(services, variable);
      const facts = {
        name: variable.name,
        kind: variable.kind,
        ...(shown === undefined ? {} : { default: shown }),
      };
      if ('options' in variable) return { ...facts, options: variable.options };
      const source = variableSource(variable);
      if (!source) return { ...facts, note: 'This variable takes any text.' };
      const read = await readQuery(services, prepared, { ...source, refId: 'options' });
      return { ...facts, ...provenance(services, prepared), ...read };
    },
  });
}

/**
 * The tools that read a pinned dashboard's data.
 *
 * @param services - The MCP services.
 * @returns The tools.
 */
export function dataTools(services: McpServices): McpTool[] {
  return [runPanelTool(services), variableOptionsTool(services)];
}
