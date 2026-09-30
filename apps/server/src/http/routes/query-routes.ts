/** The query endpoints: the settings, for admins, and the queries a thread may use, for editors. */
import {
  getQueryGuideEndpoint,
  getQuerySettingsEndpoint,
  listQueryChoicesEndpoint,
  previewQueryEndpoint,
  saveQuerySettingsEndpoint,
} from '@querent/shared';
import type { Hono } from 'hono';
import type { Connections } from '../../connections/connections.ts';
import type { Dashboards } from '../../dashboards/dashboards.ts';
import { builderGuides } from '../../dashboards/queries/index.ts';
import { previewData } from '../../dashboards/query-preview.ts';
import type { Managed } from '../../provisioning/managed.ts';
import type { QuerySettingsService } from '../../settings/query-settings.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { actorOf } from '../principal.ts';

/** The services the query endpoints use. */
export interface QueryRouteServices {
  /** The query settings. */
  readonly querySettings: QuerySettingsService;
  /** The dashboards, which validate and test-run a preview. */
  readonly dashboards: Dashboards;
  /** The connectors, which a preview can run on. */
  readonly connections: Connections;
  /** What the configuration file manages. */
  readonly managed: Managed;
}

/**
 * Mounts the endpoints that describe and preview queries, for admins.
 *
 * @param app - The app.
 * @param services - The query settings, the dashboards and the connectors.
 */
function mountPreviewRoutes(app: Hono<AppEnv>, services: QueryRouteServices): void {
  mountEndpoint(app, getQueryGuideEndpoint, {
    access: 'admin',
    handle: () => {
      // Builders and saved queries are written in SQL and PromQL only.
      const connectors = services.connections
        .subjects()
        .flatMap(({ subject, language }) =>
          language === 'sql' || language === 'promql' ? [{ name: subject.name, language }] : [],
        );
      return { builders: builderGuides(), connectors };
    },
  });
  mountEndpoint(app, previewQueryEndpoint, {
    access: 'admin',
    handle: ({ body }) => {
      const stored = services.querySettings.get().saved;
      const draft = body.saved;
      const saved = draft ? [draft, ...stored.filter((each) => each.id !== draft.id)] : stored;
      return previewData(services.dashboards, {
        data: body.data,
        chart: body.chart,
        saved,
        from: body.from,
        dialectOf: (connector) => services.connections.lookup(connector)?.dialect,
      });
    },
  });
}

/**
 * Mounts the query endpoints.
 *
 * @param app - The app.
 * @param services - The query settings, the dashboards and the connectors.
 */
export function mountQueryEndpoints(app: Hono<AppEnv>, services: QueryRouteServices): void {
  const { querySettings } = services;
  mountEndpoint(app, getQuerySettingsEndpoint, {
    access: 'admin',
    handle: () => querySettings.get(),
  });
  mountEndpoint(app, saveQuerySettingsEndpoint, {
    access: 'admin',
    handle: ({ body, principal }) => {
      services.managed.refuseChange('settings', 'queries');
      return querySettings.save(body, actorOf(principal));
    },
  });
  mountEndpoint(app, listQueryChoicesEndpoint, {
    access: 'editor',
    handle: () => ({ queries: querySettings.choices() }),
  });
  mountPreviewRoutes(app, services);
}
