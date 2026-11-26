/**
 * The MCP endpoint: one path, `POST /api/mcp`, that takes a JSON-RPC message and answers with a
 * JSON object. It is a raw route because its body and its errors follow the MCP wire format, not
 * quanthea's contracts. Only an API token signs a request in: a session cookie is refused, so a
 * page in a browser cannot drive it. It opens no stream, so `GET` and `DELETE` answer 405. Every
 * tool call is written down with the token it came with (`auth/token-activity.ts`).
 */
import { apiPrefix, mcpPath } from '@quanthea/shared';
import type { Context, Hono } from 'hono';
import { apiTokenOf } from '../../auth/bearer.ts';
import type { TokenActivity } from '../../auth/token-activity.ts';
import { AppError } from '../../lib/errors.ts';
import type { Logger } from '../../lib/logger.ts';
import { errorAnswer, RpcError, rpcCodes } from '../../mcp/protocol.ts';
import type { McpServer } from '../../mcp/server.ts';
import type { McpToolContext } from '../../mcp/tool.ts';
import { accessMiddleware } from '../access.ts';
import type { AppEnv } from '../app-env.ts';
import { clientAddress } from '../client-address.ts';
import { signedIn } from '../principal.ts';

/** What the MCP route needs. */
export interface McpRouteDependencies {
  /** The MCP server. */
  readonly mcp: McpServer;
  /** Whether the MCP endpoint answers, read at each request. */
  readonly mcpEnabled: () => boolean;
  /** quanthea's origin, when configured; else the origin the request was sent to. */
  readonly publicUrl: string | undefined;
  /** The record of what tokens did. */
  readonly activity: Pick<TokenActivity, 'record'>;
  /** How many proxies in front of quanthea append to `X-Forwarded-For`. */
  readonly trustedProxyHops: number;
  /** Where each tool call is logged. */
  readonly logger: Pick<Logger, 'info'>;
}

/**
 * Refuses a request the endpoint does not take: one while it is turned off, one without an API
 * token, and one a browser sends from another site.
 *
 * @param context - The request's context.
 * @param dependencies - The setting and quanthea's origin.
 * @throws {AppError} `forbidden`.
 */
function refuseUnfit(context: Context<AppEnv>, dependencies: McpRouteDependencies): void {
  const { raw } = context.req;
  if (!dependencies.mcpEnabled()) throw new AppError('forbidden', 'The MCP server is turned off.');
  if (apiTokenOf(raw) === undefined)
    throw new AppError('forbidden', 'Send an MCP token as Authorization: Bearer.');
  const origin = raw.headers.get('origin');
  const own = dependencies.publicUrl ?? new URL(raw.url).origin;
  if (origin !== null && origin !== own)
    throw new AppError('forbidden', 'This request comes from another site.');
}

/**
 * Who a request to the endpoint acts as, with the function that writes its tool calls down.
 *
 * @param context - The request's context.
 * @param dependencies - The record, the proxies in front and the logger.
 * @returns What a tool call runs with.
 */
function callerOf(context: Context<AppEnv>, dependencies: McpRouteDependencies): McpToolContext {
  const principal = signedIn(context.get('principal'));
  const token = context.get('apiToken');
  const address = clientAddress(context, dependencies.trustedProxyHops);
  const { id: userId, role } = principal;
  return {
    principal,
    signal: context.req.raw.signal,
    onCall: (note) => {
      if (!token) return;
      dependencies.activity.record({ ...note, token, userId, role, address });
      const { tool, outcome, durationMs } = note;
      const fields = { tool, outcome, durationMs, tokenId: token.id, userId, role, address };
      dependencies.logger.info('mcp tool call', fields);
    },
  };
}

/**
 * Mounts the MCP endpoint.
 *
 * @param app - The app.
 * @param dependencies - The MCP server, the setting and quanthea's origin.
 */
export function mountMcpRoute(app: Hono<AppEnv>, dependencies: McpRouteDependencies): void {
  const path = `${apiPrefix}${mcpPath}`;
  app.post(path, accessMiddleware('viewer'), async (context) => {
    refuseUnfit(context, dependencies);
    const unread = Symbol('unread');
    const body: unknown = await context.req.json().catch(() => unread);
    const { raw } = context.req;
    const answer =
      body === unread
        ? errorAnswer(undefined, new RpcError(rpcCodes.parseError, 'Parse error'))
        : await dependencies.mcp.handle(
            { headers: raw.headers, body },
            callerOf(context, dependencies),
          );
    if (answer.body === undefined) return context.body(null, 202);
    return context.json(answer.body, answer.status);
  });
  app.on(['GET', 'DELETE'], path, accessMiddleware('viewer'), (context) => {
    context.header('Allow', 'POST');
    return context.json({ error: { code: 'bad_request', message: 'Use POST.' } }, 405);
  });
}
