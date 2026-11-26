/**
 * The MCP server: it reads one JSON-RPC message, runs the method it names, and returns the
 * answer. It keeps no state between requests. The tools it lists and calls are those the caller's
 * role may use, and the `query` group only while an admin has turned it on. Every tool reads.
 */
import { hasRole, type Role } from '@quanthea/shared';
import { AppError } from '../lib/errors.ts';
import type { Logger } from '../lib/logger.ts';
import { alertTools } from './alert-tools.ts';
import { dashboardTools } from './dashboard-tools.ts';
import { dataTools } from './data-tools.ts';
import {
  checkModernRequest,
  eraOf,
  errorAnswer,
  legacyVersions,
  type McpAnswer,
  type ProtocolEra,
  RpcError,
  type RpcMessage,
  readMessage,
  resultAnswer,
  rpcCodes,
  supportedVersions,
} from './protocol.ts';
import { queryTools } from './query-tools.ts';
import { reportTools } from './report-tools.ts';
import type { McpServices } from './services.ts';
import { type McpTool, type McpToolContext, type ToolCallNote, ToolRefusal } from './tool.ts';

/** How long a client may keep a list or the server's description, in milliseconds. */
const listTtlMs = 60_000;

/** What a client is told the server is for. */
const instructions =
  'quanthea holds pinned dashboards, alerts and scheduled reports over the data sources of this installation. Every tool reads; none changes anything. Start with search_dashboards, then get_dashboard and run_panel. What a result shows of the data follows the access level an admin gave its connector: 1 whether the query ran, 2 the shape, 3 a summary of each field, 4 the rows. Each result names the query, the time range and the access level it was made with, and a link that opens it in quanthea.';

/** What the MCP server needs. */
export interface McpServerDependencies {
  /** The services the tools read. */
  readonly services: McpServices;
  /** Whether the `query` group of tools is on, read at each request. */
  readonly queryTools: () => boolean;
  /** quanthea's version. */
  readonly version: string;
  /** Where a failure of a tool is logged. */
  readonly logger: Pick<Logger, 'error'>;
}

/** One request to the MCP server. */
export interface McpRequest {
  /** The HTTP headers. */
  readonly headers: Headers;
  /** The decoded JSON body. */
  readonly body: unknown;
}

/** The MCP server. */
export interface McpServer {
  /**
   * Answers one message.
   *
   * @param request - The headers and the decoded body.
   * @param context - Who calls, and the signal.
   * @returns The HTTP status and the JSON-RPC answer; a notification gets a 202 with no body.
   */
  handle(request: McpRequest, context: McpToolContext): Promise<McpAnswer>;
}

/** What a method runs with. */
interface Call {
  /** The tools the caller may use. */
  readonly tools: readonly McpTool[];
  /** The era the request speaks. */
  readonly era: ProtocolEra;
  /** The message. */
  readonly message: RpcMessage;
  /** Who calls, and the signal. */
  readonly context: McpToolContext;
  /** quanthea's version. */
  readonly version: string;
}

/**
 * The fields a result of the current revision carries beside its own.
 *
 * @param era - The era the request speaks.
 * @returns The fields; none for an earlier revision.
 */
function complete(era: ProtocolEra) {
  return era.modern ? { resultType: 'complete' } : {};
}

/**
 * How long a result may be kept and for whom, in the current revision. What a caller may list
 * depends on their role, so nothing is shared between callers.
 *
 * @param era - The era the request speaks.
 * @returns The fields; none for an earlier revision.
 */
function cached(era: ProtocolEra) {
  return era.modern ? { ttlMs: listTtlMs, cacheScope: 'private' } : {};
}

/**
 * The server's description for the current revision.
 *
 * @param call - The call.
 * @returns The versions, the capabilities and what the server is for.
 */
function discover({ era, version }: Call) {
  return {
    ...complete(era),
    ...cached(era),
    supportedVersions,
    capabilities: { tools: {} },
    instructions,
    _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'quanthea', version } },
  };
}

/**
 * The answer to `initialize`, which opens an earlier revision. The client's revision is taken when
 * it is one served that way, else the newest of them.
 *
 * @param call - The call.
 * @returns The revision, the capabilities and what the server is for.
 */
function initialize({ message, version }: Call) {
  const asked = message.params.protocolVersion;
  const known = legacyVersions.find((each) => each === asked);
  return {
    protocolVersion: known ?? legacyVersions[0],
    capabilities: { tools: {} },
    serverInfo: { name: 'quanthea', version },
    instructions,
  };
}

/**
 * The tools the caller may use, as a client lists them.
 *
 * @param call - The call.
 * @returns The tools, each with the schema of its arguments.
 */
function listTools({ tools, era }: Call) {
  const listed = tools.map(({ name, title, description, inputSchema }) => ({
    name,
    title,
    description,
    inputSchema,
    annotations: { readOnlyHint: true },
  }));
  return { ...complete(era), ...cached(era), tools: listed };
}

/**
 * A tool's result as a client reads it: the JSON as text, and as structured content.
 *
 * @param era - The era the request speaks.
 * @param result - What the tool returned.
 * @returns The result.
 */
function toolResult(era: ProtocolEra, result: object) {
  const content = [{ type: 'text', text: JSON.stringify(result) }];
  return { ...complete(era), content, structuredContent: result, isError: false };
}

/**
 * A refusal of a tool call as a client reads it: a message the model can act on.
 *
 * @param era - The era the request speaks.
 * @param message - What is wrong.
 * @returns The result, marked as an error.
 */
function toolFailure(era: ProtocolEra, message: string) {
  return { ...complete(era), content: [{ type: 'text', text: message }], isError: true };
}

/** The longest tool name kept in the record of a call. */
const notedNameLength = 100;

/**
 * The function that tells the caller's record how a tool call ended.
 *
 * @param call - The call.
 * @returns A function that takes the outcome.
 */
function noteOf({ message, context }: Call): (outcome: ToolCallNote['outcome']) => void {
  const startedAt = performance.now();
  const tool = String(message.params.name).slice(0, notedNameLength);
  const input = message.params.arguments;
  return (outcome) =>
    context.onCall?.({
      tool,
      input,
      outcome,
      durationMs: Math.round(performance.now() - startedAt),
    });
}

/**
 * Calls a tool, and notes how the call ended. A refusal the caller can correct is a result marked
 * as an error; a tool the caller may not use is as unknown as one that does not exist.
 *
 * @param call - The call.
 * @returns The tool's result.
 * @throws {RpcError} `invalidParams` for an unknown tool.
 */
async function callTool(call: Call) {
  const { tools, era, message, context } = call;
  const { name, arguments: input } = message.params;
  const note = noteOf(call);
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    note('refused');
    throw new RpcError(rpcCodes.invalidParams, `Unknown tool: ${String(name)}`);
  }
  try {
    const result = await tool.call(input, context);
    note('ok');
    return toolResult(era, result);
  } catch (error) {
    const refused = error instanceof ToolRefusal || error instanceof AppError;
    note(refused ? 'refused' : 'failed');
    if (refused) return toolFailure(era, error.message);
    throw error;
  }
}

/** The methods of the current revision. */
const modernMethods: Readonly<Record<string, (call: Call) => unknown>> = {
  'server/discover': discover,
  'tools/list': listTools,
  'tools/call': callTool,
};

/** The methods of the earlier revisions. */
const legacyMethods: Readonly<Record<string, (call: Call) => unknown>> = {
  initialize,
  ping: () => ({}),
  'tools/list': listTools,
  'tools/call': callTool,
};

/**
 * Runs the method a message names.
 *
 * @param call - The call.
 * @returns The method's result.
 * @throws {RpcError} `methodNotFound` for a method the request's revision does not have.
 */
function dispatch(call: Call): unknown {
  const methods = call.era.modern ? modernMethods : legacyMethods;
  const method = Object.hasOwn(methods, call.message.method)
    ? methods[call.message.method]
    : undefined;
  if (!method)
    throw new RpcError(rpcCodes.methodNotFound, `Method not found: ${call.message.method}`, 404);
  return method(call);
}

/**
 * The tools a caller may use.
 *
 * @param tools - Every tool.
 * @param role - The caller's role.
 * @param queryTools - Whether the `query` group is on.
 * @returns Those the role reaches, without the `query` group while it is off.
 */
function toolsFor(tools: readonly McpTool[], role: Role, queryTools: boolean): McpTool[] {
  return tools.filter(
    (tool) => hasRole(role, tool.minimumRole) && (queryTools || tool.group !== 'query'),
  );
}

/** What has been read of a request when it fails. */
interface Progress {
  /** The message, once the body was read as one. */
  message?: RpcMessage;
  /** The era, once the request's revision was known. */
  era?: ProtocolEra;
}

/**
 * The answer to a request that failed. A refusal goes back as it is; anything else is logged and
 * answered as an internal error that says nothing of its cause.
 *
 * @param progress - What had been read of the request.
 * @param error - What was thrown.
 * @param logger - Where an unexpected failure is logged.
 * @returns The answer.
 */
function failureAnswer(
  progress: Progress,
  error: unknown,
  logger: Pick<Logger, 'error'>,
): McpAnswer {
  const id = progress.message?.id;
  const modern = progress.era?.modern ?? true;
  if (error instanceof RpcError) return errorAnswer(id, error, modern);
  const cause = error instanceof Error ? error.message : 'unknown';
  logger.error('mcp request failed', { method: progress.message?.method, error: cause });
  return errorAnswer(id, new RpcError(rpcCodes.internalError, 'Internal error', 500), modern);
}

/**
 * Every tool of the server.
 *
 * @param services - The MCP services.
 * @returns The tools, in the order they are listed.
 */
function allTools(services: McpServices): McpTool[] {
  return [
    ...dashboardTools(services),
    ...dataTools(services),
    ...alertTools(services),
    ...reportTools(services),
    ...queryTools(services),
  ];
}

/**
 * Creates the MCP server.
 *
 * @param dependencies - The services, the settings, the version and the logger.
 * @returns The server.
 */
export function createMcpServer(dependencies: McpServerDependencies): McpServer {
  const { version, logger } = dependencies;
  const all = allTools(dependencies.services);
  const answer = async (request: McpRequest, context: McpToolContext, progress: Progress) => {
    const message = readMessage(request.body);
    progress.message = message;
    const era = eraOf(request.headers, message);
    progress.era = era;
    if (message.id === undefined) return { status: 202 } satisfies McpAnswer;
    if (era.modern) checkModernRequest(request.headers, message, era.version);
    const tools = toolsFor(all, context.principal.role, dependencies.queryTools());
    return resultAnswer(message.id, await dispatch({ tools, era, message, context, version }));
  };
  return {
    handle: (request, context) => {
      const progress: Progress = {};
      return answer(request, context, progress).catch((error: unknown) =>
        failureAnswer(progress, error, logger),
      );
    },
  };
}
