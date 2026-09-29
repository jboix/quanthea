/** The Hono app: middleware, `/api` routes, and the SPA with its `index.html` fallback. */
import { apiPrefix, type ServerSettingsView } from '@querent/shared';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import type { Agent } from './agent/run.ts';
import type { AuthModeControl } from './auth/auth-mode-control.ts';
import type { Authenticator } from './auth/authenticator.ts';
import type { PasswordAccounts } from './auth/password-accounts.ts';
import type { LinkedIdentities } from './auth/providers/linked-identities.ts';
import type { ProviderFlows } from './auth/providers/provider-flow.ts';
import type { SignInSettings } from './auth/providers/sign-in-settings.ts';
import type { Sessions } from './auth/sessions.ts';
import type { UserAdminDependencies } from './auth/user-admin.ts';
import type { Users } from './auth/users.ts';
import type { Connections } from './connections/connections.ts';
import type { Dashboards } from './dashboards/dashboards.ts';
import type { ModelView } from './gate/model-view.ts';
import type { AppEnv } from './http/app-env.ts';
import { authenticate } from './http/authenticate.ts';
import { refuseCrossSite } from './http/csrf.ts';
import { handleErrors, handleNotFound } from './http/error-handling.ts';
import { logRequests } from './http/request-log.ts';
import { mountAuthRoutes } from './http/routes/auth-routes.ts';
import { mountAuthSettingsEndpoints } from './http/routes/auth-settings-routes.ts';
import { mountBinEndpoints } from './http/routes/bin-routes.ts';
import { mountChartEndpoints } from './http/routes/chart-routes.ts';
import { mountChatRoute } from './http/routes/chat-route.ts';
import { mountConnectorRoutes } from './http/routes/connector-routes.ts';
import {
  type DashboardRouteOptions,
  mountDashboardEndpoints,
} from './http/routes/dashboard-routes.ts';
import { mountProviderFlowRoutes } from './http/routes/provider-routes.ts';
import { mountQueryEndpoints } from './http/routes/query-routes.ts';
import { mountServerSettingsEndpoint } from './http/routes/server-settings-routes.ts';
import { mountSettingsEndpoints } from './http/routes/settings-routes.ts';
import { mountSignInSettingsEndpoints } from './http/routes/sign-in-settings-routes.ts';
import { mountSystemRoutes } from './http/routes/system-routes.ts';
import { mountThreadEndpoints } from './http/routes/thread-routes.ts';
import { mountUsageEndpoints } from './http/routes/usage-routes.ts';
import { mountUserEndpoints } from './http/routes/user-routes.ts';
import { noStoreApi, securityHeaders } from './http/security-headers.ts';
import { mountSpa } from './http/spa.ts';
import type { Logger } from './lib/logger.ts';
import type { Managed } from './provisioning/managed.ts';
import type { ChartSettingsService } from './settings/chart-settings.ts';
import type { ModelSettingsService } from './settings/model-settings.ts';
import type { QuerySettingsService } from './settings/query-settings.ts';
import type { RetentionSettingsService } from './settings/retention-settings.ts';
import type { ThreadBin } from './threads/bin.ts';
import type { Threads } from './threads/threads.ts';
import type { Usage } from './usage/usage.ts';

/** Everything the app needs from the bootstrap. */
export interface AppDependencies {
  /** The server version reported by `/api/health`. */
  readonly version: string;
  /** Identifies the principal of each request. */
  readonly authenticator: Authenticator;
  /** querent's origin, when configured: the CSRF check and HSTS use it. */
  readonly publicUrl: string | undefined;
  /** Sessions, when the session key is set. */
  readonly sessions: Sessions | undefined;
  /** Password accounts, when the session key and the pepper are set. */
  readonly passwords: PasswordAccounts | undefined;
  /** The users. */
  readonly users: Users;
  /** What changing a user needs. */
  readonly userAdmin: UserAdminDependencies;
  /** The authentication mode, switched without a restart. */
  readonly authMode: AuthModeControl;
  /** The sign-in providers, and whether passwords sign in. */
  readonly signInSettings: SignInSettings;
  /** One's own linked providers. */
  readonly linkedIdentities: LinkedIdentities;
  /** Provider sign-ins, when querent has a public URL and sessions. */
  readonly flows: ProviderFlows | undefined;
  /** How many proxies in front of querent append to `X-Forwarded-For`. */
  readonly trustedProxyHops: number;
  /** Receives request and error logs. */
  readonly logger: Logger;
  /** The directory holding the built SPA. */
  readonly webDir: string;
  /** The configured connectors. */
  readonly connections: Connections;
  /** What the configuration file manages, read-only here. */
  readonly managed: Managed;
  /** The dashboards service. */
  readonly dashboards: Dashboards;
  /** The model gateway settings. */
  readonly modelSettings: ModelSettingsService;
  /** The threads. */
  readonly threads: Threads;
  /** The bin of threads. */
  readonly bin: ThreadBin;
  /** Writes a dashboard's description and tags when it is pinned. */
  readonly describeForPin: NonNullable<DashboardRouteOptions['describe']>;
  /** The agent. */
  readonly agent: Agent;
  /** The connectors as the model sees them. */
  readonly modelView: ModelView;
  /** The usage ledger. */
  readonly usage: Usage;
  /** The query settings. */
  readonly querySettings: QuerySettingsService;
  /** The chart settings. */
  readonly chartSettings: ChartSettingsService;
  /** How long deleted threads stay in the bin. */
  readonly retention: RetentionSettingsService;
  /** The system settings, as read at startup, for Settings → Server. */
  readonly serverSettings: ServerSettingsView;
}

/**
 * Mounts every `/api` route.
 *
 * @param app - The app.
 * @param dependencies - The services the routes use.
 */
function mountApiRoutes(app: Hono<AppEnv>, dependencies: AppDependencies): void {
  mountAuthRoutes(app, {
    ...dependencies,
    modeOf: () => dependencies.authenticator.mode,
    passwordSignIn: () => dependencies.signInSettings.passwordSignIn(),
  });
  mountUserEndpoints(app, dependencies);
  mountAuthSettingsEndpoints(app, dependencies.authMode);
  mountSignInSettingsEndpoints(app, dependencies);
  mountProviderFlowRoutes(app, dependencies.flows);
  mountSystemRoutes(app, {
    version: dependencies.version,
    authModeOf: () => dependencies.authenticator.mode,
  });
  mountConnectorRoutes(app, dependencies.connections, dependencies.managed);
  mountDashboardEndpoints(app, dependencies.dashboards, {
    onPinnedView: dependencies.usage.recordPinnedView,
    ownerOf: dependencies.bin.ownerOf,
    describe: dependencies.describeForPin,
  });
  mountSettingsEndpoints(app, dependencies.modelSettings);
  mountServerSettingsEndpoint(app, dependencies.serverSettings);
  mountUsageEndpoints(app, dependencies.usage);
  mountQueryEndpoints(app, dependencies);
  mountChartEndpoints(app, dependencies.chartSettings);
  mountThreadEndpoints(app, dependencies);
  mountBinEndpoints(app, dependencies);
  mountChatRoute(app, dependencies.agent, dependencies.threads);
}

/**
 * Builds the app. It holds no global state, so tests build one per case.
 *
 * @param dependencies - The services the routes use.
 * @returns The app, ready for `Bun.serve` or `app.request()`.
 */
export function createApp(dependencies: AppDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use(requestId());
  app.use(securityHeaders(dependencies.publicUrl));
  app.use(noStoreApi());
  app.use(logRequests(dependencies.logger));
  app.use(refuseCrossSite(dependencies.publicUrl));
  app.use(`${apiPrefix}/*`, authenticate(dependencies.authenticator));

  mountApiRoutes(app, dependencies);
  mountSpa(app, dependencies.webDir);

  app.onError(handleErrors(dependencies.logger));
  app.notFound(handleNotFound);
  return app;
}
