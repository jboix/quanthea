import { expect, test } from 'bun:test';
import { homePathFor, routeAccess } from './route-access.ts';

test('screen roles match the route table in docs/architecture.md', () => {
  expect(routeAccess).toEqual({
    '/threads/new': 'editor',
    '/threads/:threadId': 'editor',
    '/library': 'viewer',
    '/account': 'viewer',
    '/d/:dashboardId': 'viewer',
    '/d/:dashboardId/v/:version': 'viewer',
    '/d/:dashboardId/v/:version/panels/:panelId': 'viewer',
    '/d/:dashboardId/v/:version/panels/:panelId/explanation': 'viewer',
    '/d/:dashboardId/v/:version/options/:name': 'viewer',
    '/d/:dashboardId/snapshots': 'editor',
    '/d/:dashboardId/conversations': 'viewer',
    '/d/:dashboardId/conversations/:conversationId': 'viewer',
    '/d/:dashboardId/similar-questions': 'viewer',
    '/d/:dashboardId/v/:version/sources': 'viewer',
    '/s/:snapshotId': 'viewer',
    '/bin': 'editor',
    '/connectors': 'admin',
    '/connectors/new': 'admin',
    '/connectors/:connectorId': 'admin',
    '/connectors/:connectorId/edit': 'admin',
    '/connectors/:connectorId/health': 'admin',
    '/settings/model': 'admin',
    '/settings/auth': 'admin',
    '/settings/users': 'admin',
    '/settings/charts': 'admin',
    '/settings/queries': 'admin',
    '/settings/usage': 'admin',
    '/settings/server': 'admin',
    '/settings/snapshots': 'admin',
    '/settings/notifications': 'admin',
  });
});

test('viewers and analysts start in the library, editors and admins in a new thread', () => {
  expect(homePathFor('viewer')).toBe('/library');
  expect(homePathFor('analyst')).toBe('/library');
  expect(homePathFor('editor')).toBe('/threads/new');
  expect(homePathFor('admin')).toBe('/threads/new');
});
