/**
 * The API token endpoints: one's own tokens (list, make, revoke), an admin revoking a user's or
 * everyone's, the record of what tokens did, and the API access settings.
 */
import {
  createApiTokenEndpoint,
  getApiAccessSettingsEndpoint,
  listApiTokensEndpoint,
  listMcpActivityEndpoint,
  revokeApiTokenEndpoint,
  revokeEveryTokenEndpoint,
  revokeUserTokensEndpoint,
  saveApiAccessSettingsEndpoint,
} from '@quanthea/shared';
import type { Hono } from 'hono';
import type { ApiTokens } from '../../auth/api-tokens.ts';
import type { TokenActivity } from '../../auth/token-activity.ts';
import { AppError } from '../../lib/errors.ts';
import type { ApiAccessSettingsService } from '../../settings/api-access-settings.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { actorOf, signedIn } from '../principal.ts';

/** What the API token endpoints need. */
export interface TokenRouteServices {
  /** The API tokens, when the session key is set. */
  readonly apiTokens: ApiTokens | undefined;
  /** Whether tokens work, and how long a new one may last. */
  readonly apiAccess: ApiAccessSettingsService;
  /** The record of what tokens did. */
  readonly tokenActivity: Pick<TokenActivity, 'latest'>;
}

/**
 * The API tokens, or why there are none.
 *
 * @param services - The route services.
 * @returns The API tokens.
 * @throws {AppError} `bad_request` when the key they need is not set.
 */
function tokensOf(services: TokenRouteServices): ApiTokens {
  if (!services.apiTokens)
    throw new AppError(
      'bad_request',
      'MCP tokens need the session key. Settings → Server shows where it comes from.',
    );
  return services.apiTokens;
}

/**
 * Mounts the endpoints of one's own tokens.
 *
 * @param app - The app.
 * @param services - The API tokens and the API access settings.
 */
function mountOwnTokenEndpoints(app: Hono<AppEnv>, services: TokenRouteServices): void {
  mountEndpoint(app, listApiTokensEndpoint, {
    access: 'viewer',
    handle: ({ principal }) => ({
      tokens: services.apiTokens?.list(signedIn(principal).id) ?? [],
      settings: services.apiAccess.get(),
    }),
  });
  mountEndpoint(app, createApiTokenEndpoint, {
    access: 'viewer',
    handle: ({ body, principal }) => tokensOf(services).issue(signedIn(principal), body),
  });
  mountEndpoint(app, revokeApiTokenEndpoint, {
    access: 'viewer',
    handle: ({ params, principal }) => {
      const owner = signedIn(principal);
      return { revoked: tokensOf(services).revoke(owner.id, params.tokenId, owner.id) };
    },
  });
}

/**
 * Mounts what an admin does with tokens: revoke a user's, revoke everyone's, and read what tokens
 * did.
 *
 * @param app - The app.
 * @param services - The API tokens and the record of what they did.
 */
function mountAdminTokenEndpoints(app: Hono<AppEnv>, services: TokenRouteServices): void {
  mountEndpoint(app, revokeUserTokensEndpoint, {
    access: 'admin',
    handle: ({ params, principal }) => ({
      revoked: services.apiTokens?.revokeAllOf(params.userId, actorOf(principal)) ?? 0,
    }),
  });
  mountEndpoint(app, revokeEveryTokenEndpoint, {
    access: 'admin',
    handle: ({ principal }) => ({
      revoked: services.apiTokens?.revokeEvery(actorOf(principal)) ?? 0,
    }),
  });
  mountEndpoint(app, listMcpActivityEndpoint, {
    access: 'admin',
    handle: async () => ({ calls: await services.tokenActivity.latest() }),
  });
}

/**
 * Mounts the API token endpoints.
 *
 * @param app - The app.
 * @param services - The API tokens and the API access settings.
 */
export function mountTokenEndpoints(app: Hono<AppEnv>, services: TokenRouteServices): void {
  mountOwnTokenEndpoints(app, services);
  mountAdminTokenEndpoints(app, services);
  mountEndpoint(app, getApiAccessSettingsEndpoint, {
    access: 'admin',
    handle: () => services.apiAccess.get(),
  });
  mountEndpoint(app, saveApiAccessSettingsEndpoint, {
    access: 'admin',
    handle: ({ body, principal }) => services.apiAccess.save(body, actorOf(principal)),
  });
}
