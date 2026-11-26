/**
 * API tokens: a person makes a token so an MCP client can read quanthea as them. A token works on
 * the MCP endpoint only, with a role no stronger than its owner's, until it expires or is revoked.
 */
import { z } from 'zod';
import { roleSchema } from '../roles.ts';
import { defineEndpoint } from './contract.ts';

/** What every API token starts with, so a leaked one is recognised for what it is. */
export const apiTokenPrefix = 'qth_';

/** The path of the MCP endpoint, under the API prefix. */
export const mcpPath = '/mcp';

/**
 * Validates the API access settings. `mcp` says whether the MCP endpoint answers; turned off, no
 * token can be made and none is of use. `maxLifetimeDays` is the longest a new token may last.
 * `mcpQueryTools` adds, for editors, the MCP tools that describe a connector's schema and run a
 * query the caller wrote.
 */
export const apiAccessSettingsSchema = z.strictObject({
  mcp: z.boolean().default(true),
  maxLifetimeDays: z.int().min(1).max(3650).default(365),
  mcpQueryTools: z.boolean().default(false),
});

/** The API access settings. */
export type ApiAccessSettings = z.infer<typeof apiAccessSettingsSchema>;

/** Validates an API token as its owner sees it. The token itself is shown once, when made. */
export const apiTokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: roleSchema,
  createdAt: z.number(),
  expiresAt: z.number(),
  lastUsedAt: z.number().nullable(),
});

/** An API token as its owner sees it. */
export type ApiTokenView = z.infer<typeof apiTokenSchema>;

/** Lists one's own tokens, with the settings a new one must follow. */
export const listApiTokensEndpoint = defineEndpoint({
  method: 'GET',
  path: '/tokens',
  output: z.object({ tokens: z.array(apiTokenSchema), settings: apiAccessSettingsSchema }),
});

/** Makes a token of one's own. The answer is the only time the token is shown. */
export const createApiTokenEndpoint = defineEndpoint({
  method: 'POST',
  path: '/tokens',
  body: z.object({
    name: z.string().trim().min(1).max(80),
    role: roleSchema,
    expiresInDays: z.int().min(1).max(3650),
  }),
  output: z.object({ token: z.string(), details: apiTokenSchema }),
});

/** Revokes one of one's own tokens. */
export const revokeApiTokenEndpoint = defineEndpoint({
  method: 'DELETE',
  path: '/tokens/:tokenId',
  params: z.object({ tokenId: z.string().min(1) }),
  output: z.object({ revoked: z.boolean() }),
});

/** Revokes every token of a user, for admins. */
export const revokeUserTokensEndpoint = defineEndpoint({
  method: 'DELETE',
  path: '/users/:userId/tokens',
  params: z.object({ userId: z.string().min(1) }),
  output: z.object({ revoked: z.int() }),
});

/** The API access settings, for admins. */
export const getApiAccessSettingsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/settings/api-access',
  output: apiAccessSettingsSchema,
});

/** Saves the API access settings. */
export const saveApiAccessSettingsEndpoint = defineEndpoint({
  method: 'PUT',
  path: '/settings/api-access',
  body: apiAccessSettingsSchema,
  output: apiAccessSettingsSchema,
});

/** Revokes every token of everyone, for admins. */
export const revokeEveryTokenEndpoint = defineEndpoint({
  method: 'DELETE',
  path: '/settings/api-access/tokens',
  output: z.object({ revoked: z.int() }),
});

/** Validates how a tool call ended: it answered, it was refused, or it failed. */
const mcpCallOutcomeSchema = z.enum(['ok', 'refused', 'failed']);

/** How a tool call on the MCP endpoint ended. */
export type McpCallOutcome = z.infer<typeof mcpCallOutcomeSchema>;

/** Validates one tool call on the MCP endpoint, as the record of what tokens did keeps it. */
const mcpCallSchema = z.object({
  id: z.string(),
  at: z.number(),
  tokenId: z.string(),
  tokenName: z.string(),
  userId: z.string(),
  /** The owner's name, or `null` once the user is gone. */
  userName: z.string().nullable(),
  role: roleSchema,
  tool: z.string(),
  /** The arguments as JSON, cut when long. */
  arguments: z.string(),
  outcome: mcpCallOutcomeSchema,
  durationMs: z.number(),
  address: z.string(),
});

/** One tool call on the MCP endpoint. */
export type McpCallView = z.infer<typeof mcpCallSchema>;

/** The latest tool calls on the MCP endpoint, the newest first, for admins. */
export const listMcpActivityEndpoint = defineEndpoint({
  method: 'GET',
  path: '/settings/api-access/activity',
  output: z.object({ calls: z.array(mcpCallSchema) }),
});
