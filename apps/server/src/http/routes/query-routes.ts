/** The recipe endpoints: the settings, for admins, and the recipes a thread may use, for editors. */
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
import { previewPanel } from '../../dashboards/recipe-preview.ts';
import { builderGuides } from '../../dashboards/recipes/guide.ts';
import type { QuerySettingsService } from '../../settings/query-settings.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { actorOf } from '../principal.ts';

/** The services the recipe endpoints use. */
export interface QueryRouteServices {
  /** The recipe settings. */
  readonly querySettings: QuerySettingsService;
  /** The dashboards, which validate and test-run a preview. */
  readonly dashboards: Dashboards;
  /** The connectors, which a preview can run on. */
  readonly connections: Connections;
}

/**
 * Mounts the endpoints that describe and preview recipes, for admins.
 *
 * @param app - The app.
 * @param services - The recipe settings, the dashboards and the connectors.
 */
function mountPreviewRoutes(app: Hono<AppEnv>, services: QueryRouteServices): void {
  mountEndpoint(app, getQueryGuideEndpoint, {
    access: 'admin',
    handle: () => {
      const connectors = services.connections
        .subjects()
        .map(({ subject, language }) => ({ name: subject.name, language }));
      return { recipes: builderGuides(), connectors };
    },
  });
  mountEndpoint(app, previewQueryEndpoint, {
    access: 'admin',
    handle: ({ body }) => {
      const stored = services.querySettings.get().saved;
      const draft = body.saved;
      const saved = draft ? [draft, ...stored.filter((each) => each.id !== draft.id)] : stored;
      return previewPanel(services.dashboards, body.panel, saved, body.from);
    },
  });
}

/**
 * Mounts the recipe endpoints.
 *
 * @param app - The app.
 * @param services - The recipe settings, the dashboards and the connectors.
 */
export function mountQueryEndpoints(app: Hono<AppEnv>, services: QueryRouteServices): void {
  const { querySettings } = services;
  mountEndpoint(app, getQuerySettingsEndpoint, {
    access: 'admin',
    handle: () => querySettings.get(),
  });
  mountEndpoint(app, saveQuerySettingsEndpoint, {
    access: 'admin',
    handle: ({ body, principal }) => querySettings.save(body, actorOf(principal)),
  });
  mountEndpoint(app, listQueryChoicesEndpoint, {
    access: 'editor',
    handle: () => ({ recipes: querySettings.choices() }),
  });
  mountPreviewRoutes(app, services);
}
