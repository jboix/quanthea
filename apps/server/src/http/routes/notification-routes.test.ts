import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { type Principal, type Role, sampleMessage } from '@quanthea/shared';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import type { Notifications } from '../../notifications/notifications.ts';
import { fakeNotifications } from '../../notifications/test/fake-notifications.ts';
import { captureLogs, fixedAuthenticator, temporaryDir } from '../../test/fixtures.ts';
import type { AppEnv } from '../app-env.ts';
import { authenticate } from '../authenticate.ts';
import { handleErrors, handleNotFound } from '../error-handling.ts';
import { mountNotificationEndpoints } from './notification-routes.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let notifications: Notifications;
let posted: string[];
let close: () => void;

beforeEach(async () => {
  dataDir = temporaryDir();
  ({ notifications, posted, close } = await fakeNotifications(dataDir.path));
});

afterEach(() => {
  close();
  dataDir.remove();
});

/**
 * An app with the notification routes, acting as one role.
 *
 * @param role - The role of every request.
 * @returns A function that sends a JSON request and returns the status and body.
 */
function client(role: Role) {
  const principal: Principal = { id: `${role}-1`, name: role, role };
  const app = new Hono<AppEnv>();
  app.use(requestId());
  app.use(authenticate(fixedAuthenticator(principal)));
  mountNotificationEndpoints(app, {
    notifications,
    users: { nameOf: (id) => Promise.resolve(id === 'admin-1' ? 'Ada' : undefined) },
  });
  app.onError(handleErrors(captureLogs().logger));
  app.notFound(handleNotFound);
  return async (method: string, path: string, body?: unknown) => {
    const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'quanthea' };
    const init = body === undefined ? { method } : { method, headers, body: JSON.stringify(body) };
    const response = await app.request(`/api${path}`, init);
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
}

const slack = {
  name: 'On call',
  kind: 'slack',
  target: 'https://hooks.slack.test/services/T/B/abcdSECRETwxyz',
  mentions: ['<!subteam^S01>'],
};

describe('the admin endpoints', () => {
  test('an admin adds, lists, changes, tests and deletes a channel, and never sees its URL', async () => {
    const admin = client('admin');
    const created = await admin('POST', '/settings/notification-channels', slack);
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      name: 'On call',
      kind: 'slack',
      target: 'hooks.slack.test/services/…/wxyz',
      createdBy: 'Ada',
      lastSentAt: null,
      alerts: 0,
    });
    const id = String(created.body.id);
    const listed = await admin('GET', '/settings/notification-channels');
    expect(JSON.stringify(listed.body)).not.toContain('SECRET');
    const changed = await admin('PATCH', `/settings/notification-channels/${id}`, { name: 'Ops' });
    expect(changed.body).toMatchObject({ name: 'Ops', target: 'hooks.slack.test/services/…/wxyz' });
    const tested = await admin('POST', `/settings/notification-channels/${id}/test`);
    expect(tested.body).toMatchObject({ channelId: id, ok: true, attempts: 1 });
    expect(posted).toEqual([slack.target]);
    const sends = await admin('GET', `/settings/notification-channels/${id}/sends`);
    expect(sends.body.sends).toMatchObject([{ event: 'alert.test', ok: true }]);
    expect((await admin('DELETE', `/settings/notification-channels/${id}`)).body).toEqual({
      deleted: true,
    });
    expect((await admin('GET', `/settings/notification-channels/${id}/sends`)).status).toBe(404);
  });

  test('a bad channel is refused with the field at fault', async () => {
    const admin = client('admin');
    const refused = await admin('POST', '/settings/notification-channels', {
      ...slack,
      target: 'http://hooks.slack.test/x',
    });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toContain('target');
  });

  test('viewers, analysts and editors are refused', async () => {
    for (const role of ['viewer', 'analyst', 'editor'] as const) {
      const as = client(role);
      expect((await as('GET', '/settings/notification-channels')).status).toBe(403);
      expect((await as('POST', '/settings/notification-channels', slack)).status).toBe(403);
      expect((await as('POST', '/settings/notification-channels/x/test')).status).toBe(403);
      expect((await as('GET', '/settings/notification-channels/x/sends')).status).toBe(403);
      expect((await as('DELETE', '/settings/notification-channels/x')).status).toBe(403);
    }
  });
});

describe('the endpoints for alerts', () => {
  test('an editor lists channels by name and kind only, and previews a template', async () => {
    await client('admin')('POST', '/settings/notification-channels', slack);
    const editor = client('editor');
    const picked = await editor('GET', '/notification-channels');
    expect(picked.status).toBe(200);
    const [channel] = picked.body.channels as Record<string, unknown>[];
    expect(Object.keys(channel ?? {}).sort()).toEqual(['id', 'kind', 'name']);
    const preview = await editor('POST', '/notification-channels/preview', {
      kind: 'discord',
      ...sampleMessage,
    });
    expect(preview.status).toBe(200);
    expect(preview.body.previews).toMatchObject([{ kind: 'discord' }]);
    expect(posted).toEqual([]);
  });

  test('a template with an unknown placeholder is refused', async () => {
    const preview = await client('editor')('POST', '/notification-channels/preview', {
      template: { title: '{secret}', body: 'b' },
    });
    expect(preview.status).toBe(400);
  });

  test('viewers and analysts are refused', async () => {
    for (const role of ['viewer', 'analyst'] as const) {
      const as = client(role);
      expect((await as('GET', '/notification-channels')).status).toBe(403);
      const body = { template: { title: 't', body: 'b' } };
      expect((await as('POST', '/notification-channels/preview', body)).status).toBe(403);
    }
  });
});
