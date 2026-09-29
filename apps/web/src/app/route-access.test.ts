import { expect, test } from 'bun:test';
import { homePathFor, routeAccess } from './route-access.ts';

test('screen roles match the route table in docs/architecture.md', () => {
  expect(routeAccess).toEqual({
    '/threads/new': 'editor',
    '/threads/:threadId': 'editor',
    '/library': 'viewer',
    '/d/:dashboardId': 'viewer',
    '/d/:dashboardId/v/:version': 'viewer',
    '/d/:dashboardId/v/:version/panels/:panelId': 'viewer',
    '/d/:dashboardId/v/:version/options/:name': 'viewer',
    '/bin': 'editor',
    '/connectors': 'admin',
    '/connectors/new': 'admin',
    '/connectors/:connectorId': 'admin',
    '/connectors/:connectorId/edit': 'admin',
    '/connectors/:connectorId/health': 'admin',
    '/settings/model': 'admin',
    '/settings/auth': 'admin',
    '/settings/retention': 'admin',
    '/settings/recipes': 'admin',
    '/settings/usage': 'admin',
  });
});

test('viewers start in the library, editors and admins in a new thread', () => {
  expect(homePathFor('viewer')).toBe('/library');
  expect(homePathFor('editor')).toBe('/threads/new');
  expect(homePathFor('admin')).toBe('/threads/new');
});
