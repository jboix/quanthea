/** The route of the model settings screen. */
import type { RouteObject } from 'react-router';
import { guarded } from '../app/route-access.ts';
import type { SessionLoader } from '../app/session.ts';
import {
  loadModelSettings,
  ModelSettingsScreen,
  modelSettingsAction,
} from '../features/settings/index.ts';
import type { ApiClient } from '../lib/api-client.ts';

/**
 * The model settings route: its loader and its save and test action run for admins only.
 *
 * @param loadSession - Loads the current session.
 * @param api - The API client.
 * @returns The route object.
 */
export function modelSettingsRoute(loadSession: SessionLoader, api: ApiClient): RouteObject {
  const path = '/settings/model';
  return {
    path,
    loader: guarded(loadSession, path, loadModelSettings(api)),
    action: guarded(loadSession, path, modelSettingsAction(api)),
    Component: ModelSettingsScreen,
  };
}
