/** The Hono app: middleware, `/api` routes, and the SPA with its `index.html` fallback. */
import { apiPrefix } from '@querent/shared';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import type { Agent } from './agent/run.ts';
import type { Authenticator } from './auth/authenticator.ts';
import type { Connections } from './connections/connections.ts';
import type { Dashboards } from './dashboards/dashboards.ts';
import type { ModelView } from './gate/model-view.ts';
import type { AppEnv } from './http/app-env.ts';
import { authenticate } from './http/authenticate.ts';
import { handleErrors, handleNotFound } from './http/error-handling.ts';
import { logRequests } from './http/request-log.ts';
import { mountChartEndpoints } from './http/routes/chart-routes.ts';
import { mountChatRoute } from './http/routes/chat-route.ts';
import { mountConnectorRoutes } from './http/routes/connector-routes.ts';
import { mountDashboardEndpoints } from './http/routes/dashboard-routes.ts';
import { mountQueryEndpoints } from './http/routes/query-routes.ts';
import { mountSettingsEndpoints } from './http/routes/settings-routes.ts';
import { mountSystemRoutes } from './http/routes/system-routes.ts';
import { mountThreadEndpoints } from './http/routes/thread-routes.ts';
import { mountUsageEndpoints } from './http/routes/usage-routes.ts';
import { securityHeaders } from './http/security-headers.ts';
import { mountSpa } from './http/spa.ts';
import type { Logger } from './lib/logger.ts';
import type { ChartSettingsService } from './settings/chart-settings.ts';
import type { ModelSettingsService } from './settings/model-settings.ts';
import type { QuerySettingsService } from './settings/query-settings.ts';
import type { Threads } from './threads/threads.ts';
import type { Usage } from './usage/usage.ts';

/** Everything the app needs from the bootstrap. */
export interface AppDependencies {
  /** The server version reported by `/api/health`. */
  readonly version: string;
  /** Identifies the principal of each request. */
  readonly authenticator: Authenticator;
  /** Receives request and error logs. */
  readonly logger: Logger;
  /** The directory holding the built SPA. */
  readonly webDir: string;
  /** The configured connectors. */
  readonly connections: Connections;
  /** The dashboards service. */
  readonly dashboards: Dashboards;
  /** The model gateway settings. */
  readonly modelSettings: ModelSettingsService;
  /** The threads. */
  readonly threads: Threads;
  /** The agent. */
  readonly agent: Agent;
  /** The connectors as the model sees them. */
  readonly modelView: ModelView;
  /** The usage ledger. */
  readonly usage: Usage;
  /** The recipe settings. */
  readonly querySettings: QuerySettingsService;
  /** The chart settings. */
  readonly chartSettings: ChartSettingsService;
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
  app.use(securityHeaders());
  app.use(logRequests(dependencies.logger));
  app.use(`${apiPrefix}/*`, authenticate(dependencies.authenticator));

  mountSystemRoutes(app, {
    version: dependencies.version,
    authMode: dependencies.authenticator.mode,
  });
  mountConnectorRoutes(app, dependencies.connections);
  mountDashboardEndpoints(app, dependencies.dashboards, dependencies.usage.recordPinnedView);
  mountSettingsEndpoints(app, dependencies.modelSettings);
  mountUsageEndpoints(app, dependencies.usage);
  mountQueryEndpoints(app, dependencies);
  mountChartEndpoints(app, dependencies.chartSettings);
  mountThreadEndpoints(app, dependencies);
  mountChatRoute(app, dependencies.agent);
  mountSpa(app, dependencies.webDir);

  app.onError(handleErrors(dependencies.logger));
  app.notFound(handleNotFound);
  return app;
}
