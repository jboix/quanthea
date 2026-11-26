/**
 * The wire format of the MCP endpoint: one JSON-RPC 2.0 message per HTTP POST, answered with one
 * JSON object. Two eras of the protocol are served. The current revision is stateless: every
 * request names its protocol version, in a header and in `params._meta`, and the two must agree.
 * The earlier revisions open with an `initialize` request; quanthea answers it and keeps no
 * session, so every later request stands alone there too.
 */
import { z } from 'zod';

/** The revisions served statelessly, the newest first. */
export const modernVersions = ['2026-07-28'] as const;

/** The revisions that open with `initialize`, the newest first. */
export const legacyVersions = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;

/** Every revision served, the newest first. */
export const supportedVersions: readonly string[] = [...modernVersions, ...legacyVersions];

/** The JSON-RPC error codes the endpoint answers with. */
export const rpcCodes = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  headerMismatch: -32020,
  unsupportedVersion: -32022,
} as const;

/** The key of the protocol version in `params._meta`. */
export const versionMetaKey = 'io.modelcontextprotocol/protocolVersion';

/** The key of the client's capabilities in `params._meta`. */
const capabilitiesMetaKey = 'io.modelcontextprotocol/clientCapabilities';

/** The id of a JSON-RPC request. */
export type RpcId = string | number;

/** A JSON-RPC message as the endpoint reads it. A message without an id is a notification. */
export interface RpcMessage {
  /** The request's id; `undefined` for a notification. */
  readonly id: RpcId | undefined;
  /** The method. */
  readonly method: string;
  /** The parameters; empty when none were sent. */
  readonly params: Readonly<Record<string, unknown>>;
}

/** Which era of the protocol a request speaks, and its revision. */
export interface ProtocolEra {
  /** Whether the revision is one served statelessly. */
  readonly modern: boolean;
  /** The revision. */
  readonly version: string;
}

/** An HTTP answer: a status, and a JSON body unless the status has none. */
export interface McpAnswer {
  /** The HTTP status. */
  readonly status: 200 | 202 | 400 | 404 | 500;
  /** The JSON body. */
  readonly body?: unknown;
}

/** A refusal of a request, answered as a JSON-RPC error. */
export class RpcError extends Error {
  /** The JSON-RPC error code. */
  readonly code: number;
  /** The HTTP status of the answer. */
  readonly status: 400 | 404 | 500;
  /** Structured context for the client. */
  readonly data: unknown;

  /**
   * Creates a refusal.
   *
   * @param code - The JSON-RPC error code.
   * @param message - What is wrong, safe to send.
   * @param status - The HTTP status of the answer.
   * @param data - Structured context for the client.
   */
  constructor(code: number, message: string, status: 400 | 404 | 500 = 400, data?: unknown) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.status = status;
    this.data = data;
  }
}

/** Validates one JSON-RPC request or notification. */
const messageSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().min(1).max(100),
  params: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Reads a JSON-RPC message from a decoded body.
 *
 * @param body - The decoded JSON body.
 * @returns The message.
 * @throws {RpcError} `invalidRequest` for anything but one request or notification.
 */
export function readMessage(body: unknown): RpcMessage {
  const parsed = messageSchema.safeParse(body);
  if (!parsed.success)
    throw new RpcError(
      rpcCodes.invalidRequest,
      'The body must be one JSON-RPC 2.0 request or notification.',
    );
  const { id, method, params } = parsed.data;
  return { id, method, params: params ?? {} };
}

/**
 * The `_meta` object of a message's parameters.
 *
 * @param message - The message.
 * @returns The object; empty when there is none.
 */
function metaOf(message: RpcMessage): Readonly<Record<string, unknown>> {
  const meta = message.params._meta;
  return typeof meta === 'object' && meta !== null ? (meta as Record<string, unknown>) : {};
}

/**
 * A header's value, decoded when it is sent as `=?base64?…?=`, the form for values that are not
 * plain ASCII.
 *
 * @param headers - The request's headers.
 * @param name - The header's name.
 * @returns The value, or `undefined` when the header is missing.
 */
function headerOf(headers: Headers, name: string): string | undefined {
  const value = headers.get(name);
  if (value === null) return undefined;
  const encoded = /^=\?base64\?(.*)\?=$/.exec(value);
  return encoded ? Buffer.from(encoded[1] ?? '', 'base64').toString('utf8') : value;
}

/**
 * The era a request speaks. `initialize` always opens a session of an earlier revision. Any other
 * request names its revision in `params._meta` or in the `MCP-Protocol-Version` header; with
 * neither, it is read as the oldest revision served, which had no such header, unless its method
 * is the current revision's discovery.
 *
 * @param headers - The request's headers.
 * @param message - The message.
 * @returns The era.
 * @throws {RpcError} `headerMismatch` when the header and the body disagree, `unsupportedVersion`
 *   for a revision that is not served.
 */
export function eraOf(headers: Headers, message: RpcMessage): ProtocolEra {
  const oldest = legacyVersions[legacyVersions.length - 1] ?? '';
  if (message.method === 'initialize') return { modern: false, version: oldest };
  const header = headerOf(headers, 'mcp-protocol-version');
  const meta = metaOf(message)[versionMetaKey];
  const inBody = typeof meta === 'string' ? meta : undefined;
  if (header !== undefined && inBody !== undefined && header !== inBody)
    throw new RpcError(
      rpcCodes.headerMismatch,
      `Header mismatch: MCP-Protocol-Version header value '${header}' does not match body value '${inBody}'`,
    );
  // A discovery that names no revision is the current one's method: it is told what it lacks.
  const unnamed = message.method === 'server/discover' ? modernVersions[0] : oldest;
  const version = inBody ?? header ?? unnamed;
  if (!supportedVersions.includes(version))
    throw new RpcError(rpcCodes.unsupportedVersion, 'Unsupported protocol version', 400, {
      supported: supportedVersions,
      requested: version,
    });
  return { modern: (modernVersions as readonly string[]).includes(version), version };
}

/**
 * Checks that a header repeats a value of the body, as the current revision requires.
 *
 * @param headers - The request's headers.
 * @param name - The header's name, as written in an error.
 * @param expected - The body's value.
 * @throws {RpcError} `headerMismatch` when the header is missing or differs.
 */
function requireHeader(headers: Headers, name: string, expected: string): void {
  const value = headerOf(headers, name);
  if (value === expected) return;
  const found = value === undefined ? 'is missing' : `value '${value}' does not match`;
  throw new RpcError(
    rpcCodes.headerMismatch,
    `Header mismatch: ${name} header ${found} body value '${expected}'`,
  );
}

/**
 * Checks what the current revision requires of every request: the protocol version and the
 * client's capabilities in `params._meta`, and headers that repeat the version, the method and,
 * for a tool call, the tool's name.
 *
 * @param headers - The request's headers.
 * @param message - The message.
 * @param version - The revision the request speaks.
 * @throws {RpcError} `invalidParams` for a missing `_meta` field, `headerMismatch` for a header.
 */
export function checkModernRequest(headers: Headers, message: RpcMessage, version: string): void {
  const meta = metaOf(message);
  for (const key of [versionMetaKey, capabilitiesMetaKey])
    if (meta[key] === undefined)
      throw new RpcError(rpcCodes.invalidParams, `Missing params._meta["${key}"].`);
  requireHeader(headers, 'MCP-Protocol-Version', version);
  requireHeader(headers, 'Mcp-Method', message.method);
  const { name } = message.params;
  if (message.method === 'tools/call' && typeof name === 'string')
    requireHeader(headers, 'Mcp-Name', name);
}

/**
 * The answer that carries a result.
 *
 * @param id - The request's id.
 * @param result - The result.
 * @returns The answer.
 */
export function resultAnswer(id: RpcId, result: unknown): McpAnswer {
  return { status: 200, body: { jsonrpc: '2.0', id, result } };
}

/**
 * The answer that carries an error. A request of an earlier revision gets a refusal of its
 * method or parameters with a 200, since a 404 there means a session that has ended.
 *
 * @param id - The request's id, or `undefined` when it could not be read.
 * @param error - The refusal.
 * @param modern - Whether the request speaks a revision served statelessly.
 * @returns The answer.
 */
export function errorAnswer(id: RpcId | undefined, error: RpcError, modern = true): McpAnswer {
  const { code, message, data } = error;
  const body = {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
  const soft = code === rpcCodes.methodNotFound || code === rpcCodes.invalidParams;
  return { status: !modern && soft ? 200 : error.status, body };
}
