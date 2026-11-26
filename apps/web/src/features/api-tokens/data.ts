/** Loads and changes one's own MCP tokens, and the MCP access settings an admin keeps. */
import {
  type ApiAccessSettings,
  type ApiTokenView,
  createApiTokenEndpoint,
  type EndpointOutput,
  getApiAccessSettingsEndpoint,
  listApiTokensEndpoint,
  listMcpActivityEndpoint,
  type McpCallView,
  type Role,
  revokeApiTokenEndpoint,
  revokeEveryTokenEndpoint,
  saveApiAccessSettingsEndpoint,
} from '@quanthea/shared';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';

/** One's tokens, with the settings a new one must follow. */
export type TokenList = EndpointOutput<typeof listApiTokensEndpoint>;

/** A token just made: its value, shown this once, and how it is listed. */
export interface CreatedToken {
  /** The token itself. */
  readonly token: string;
  /** How it is listed. */
  readonly details: ApiTokenView;
}

/** What the tokens dialog submits, as JSON. */
export type TokenIntent =
  | {
      readonly intent: 'create';
      readonly name: string;
      readonly role: Role;
      readonly expiresInDays: number;
    }
  | { readonly intent: 'revoke'; readonly tokenId: string };

/** What a token action answers: the token made, if any, or why not. */
export type TokenOutcome =
  | { readonly ok: true; readonly created?: CreatedToken }
  | { readonly ok: false; readonly message: string };

/**
 * The loader of the tokens dialog: one's tokens and the settings.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadApiTokens(api: ApiClient) {
  return ({ request }: LoaderFunctionArgs): Promise<TokenList> =>
    api.call(listApiTokensEndpoint, undefined, { signal: request.signal });
}

/**
 * Runs one intent of the tokens dialog.
 *
 * @param api - The API client.
 * @param intent - The intent.
 * @returns The outcome.
 */
async function runTokenIntent(api: ApiClient, intent: TokenIntent): Promise<TokenOutcome> {
  if (intent.intent === 'revoke') {
    await api.call(revokeApiTokenEndpoint, { params: { tokenId: intent.tokenId } });
    return { ok: true };
  }
  const { name, role, expiresInDays } = intent;
  const created = await api.call(createApiTokenEndpoint, { body: { name, role, expiresInDays } });
  return { ok: true, created };
}

/**
 * The action of the tokens dialog: make a token or revoke one, keeping a refusal as an outcome.
 *
 * @param api - The API client.
 * @returns The action.
 */
export function apiTokensAction(api: ApiClient) {
  return async ({ request }: ActionFunctionArgs): Promise<TokenOutcome> => {
    try {
      return await runTokenIntent(api, (await request.json()) as TokenIntent);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      return { ok: false, message: error.message };
    }
  };
}

/** What the MCP access screen shows: the settings, and the latest tool calls. */
export interface ApiAccessData {
  /** The settings. */
  readonly settings: ApiAccessSettings;
  /** The latest tool calls, the newest first. */
  readonly calls: readonly McpCallView[];
}

/** What the MCP access screen submits, as JSON. */
export type ApiAccessIntent =
  | { readonly intent: 'save'; readonly settings: ApiAccessSettings }
  | { readonly intent: 'revoke-every' };

/** What the MCP access screen's action returns. */
export type ApiAccessOutcome =
  | { readonly ok: true; readonly revoked?: number }
  | { readonly ok: false; readonly message: string };

/**
 * The loader of the MCP access screen.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadApiAccess(api: ApiClient) {
  return async (): Promise<ApiAccessData> => {
    const [settings, activity] = await Promise.all([
      api.call(getApiAccessSettingsEndpoint),
      api.call(listMcpActivityEndpoint),
    ]);
    return { settings, calls: activity.calls };
  };
}

/**
 * The action of the MCP access screen: saves the settings or revokes every token, keeping a
 * refusal as an outcome.
 *
 * @param api - The API client.
 * @returns The action.
 */
export function apiAccessAction(api: ApiClient) {
  return async ({ request }: ActionFunctionArgs): Promise<ApiAccessOutcome> => {
    const sent = (await request.json()) as ApiAccessIntent;
    try {
      if (sent.intent === 'revoke-every')
        return { ok: true, ...(await api.call(revokeEveryTokenEndpoint)) };
      await api.call(saveApiAccessSettingsEndpoint, { body: sent.settings });
      return { ok: true };
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'bad_request') throw error;
      return { ok: false, message: error.message };
    }
  };
}
