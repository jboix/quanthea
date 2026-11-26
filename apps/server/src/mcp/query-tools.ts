/**
 * The tools that go past what is pinned: the definitions of business terms, a connector's schema,
 * and a query the caller wrote. The last two are the `query` group, which an admin turns on and
 * only editors may call. A written query runs as the agent's own test query does: through the
 * gate, inside the connector's scope and guardrails, with what shows set by its access level.
 */
import { queryTemplateSchema, resolveTimeRange, timeRangeSchema } from '@quanthea/shared';
import { z } from 'zod';
import { levelOf, type McpServices } from './services.ts';
import { defineTool, type McpTool, ToolRefusal } from './tool.ts';

/** The range a written query covers when none is given. */
const defaultRange = { from: 'now-1h', to: 'now' };

/**
 * Whether a text holds every word of a search, in any case.
 *
 * @param text - The text.
 * @param search - The words.
 * @returns `true` when each word is in the text.
 */
function holdsWords(text: string, search: string): boolean {
  const lower = text.toLowerCase();
  return search
    .toLowerCase()
    .split(/\s+/)
    .every((word) => lower.includes(word));
}

/**
 * The tool that lists the definitions of business terms.
 *
 * @param services - The MCP services.
 * @returns The tool.
 */
function definitionsTool(services: McpServices): McpTool {
  return defineTool({
    name: 'list_definitions',
    title: 'List definitions',
    description:
      'List the definitions of business terms: what a name such as "active user" means here, its synonyms, and the checked query that computes it per language. A definition that names a hidden field is left out.',
    minimumRole: 'viewer',
    group: 'read',
    input: z.object({
      search: z.string().max(200).optional().describe('Words in the name, synonyms or meaning.'),
    }),
    run: ({ search = '' }) => {
      const all = services.definitions.forModel().map(({ definition, version }) => ({
        ...definition,
        version,
      }));
      const definitions = all.filter(({ name, synonyms, meaning }) =>
        holdsWords([name, ...synonyms, meaning].join(' '), search),
      );
      return { definitions, url: `${services.publicUrl ?? ''}/definitions` };
    },
  });
}

/**
 * The tool that lists the connectors, or describes one's schema.
 *
 * @param services - The MCP services.
 * @returns The tool.
 */
function describeTool(services: McpServices): McpTool {
  return defineTool({
    name: 'describe_connector',
    title: 'Describe a connector',
    description:
      'Without a connector, list the connectors: name, kind, query language and access level. With one, describe its schema as its access level shows it: tables and columns, or metrics and labels. Pass a scope to list only entities whose name contains it.',
    minimumRole: 'editor',
    group: 'query',
    input: z.object({
      connector: z.string().min(1).max(100).optional().describe("A connector's name."),
      scope: z.string().max(100).optional().describe('Text an entity name must contain.'),
    }),
    run: async ({ connector, scope }, { signal }) => {
      if (connector === undefined) return { connectors: services.modelView.connectors() };
      const accessLevel = levelOf(services, connector);
      if (accessLevel === null) throw new ToolRefusal(`There is no connector "${connector}".`);
      const schema = await services.modelView.describe(connector, scope, signal);
      return { connector, accessLevel, schema };
    },
  });
}

/**
 * The tool that runs a query the caller wrote.
 *
 * @param services - The MCP services.
 * @returns The tool.
 */
function runQueryTool(services: McpServices): McpTool {
  return defineTool({
    name: 'run_query',
    title: 'Run a query',
    description:
      "Run a query you write on a connector, in the connector's own language, over a time range. It only reads, inside the connector's scope and limits. What the result shows follows the connector's access level: 1 whether the query ran, 2 the shape, 3 a summary of each field, 4 the rows (at most 500). Use describe_connector first.",
    minimumRole: 'editor',
    group: 'query',
    input: z.object({
      query: queryTemplateSchema.describe('The query, with the connector it runs on.'),
      time: timeRangeSchema
        .optional()
        .describe('`now`, `now-7d` or ISO 8601 times with an offset. The last hour by default.'),
    }),
    run: async ({ query, time }, { signal }) => {
      const now = (services.now ?? Date.now)();
      const { from, to } = resolveTimeRange(time ?? defaultRange, now);
      if (!(from < to)) throw new ToolRefusal('The time range ends before it starts.');
      const timeRange = { from: new Date(from), to: new Date(to) };
      const request = { refId: 'query', template: query, variables: {}, timeRange, signal };
      return {
        connector: query.connector,
        accessLevel: levelOf(services, query.connector),
        query,
        time: { from: timeRange.from.toISOString(), to: timeRange.to.toISOString() },
        result: await services.modelView.testQuery(query.connector, request),
      };
    },
  });
}

/**
 * The definitions tool, and the tools that describe a connector and run a written query.
 *
 * @param services - The MCP services.
 * @returns The tools.
 */
export function queryTools(services: McpServices): McpTool[] {
  return [definitionsTool(services), describeTool(services), runQueryTool(services)];
}
