import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { connectorInputSchema, type Principal } from '@querent/shared';
import { createApp } from '../app.ts';
import { eventsSpec } from '../dashboards/test/events-spec.ts';
import { captureLogs, fixedAuthenticator, temporaryDir, testServices } from '../test/fixtures.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;
let ada: Principal;
let bob: Principal;
let root: Principal;
const vera: Principal = { id: 'viewer-1', name: 'Vera', role: 'viewer' };
let threadId = '';
let dashboardId = '';

beforeAll(async () => {
  dataDir = temporaryDir();
  services = await testServices(dataDir.path);
  const input = { name: 'events', kind: 'memory', config: {}, secret: { token: 't' } };
  await services.connections.create(connectorInputSchema.parse(input), 'admin-1');
  const person = async (email: string, name: string, role: Principal['role']) => {
    const user = await services.users.create({ email, name, role }, 'x');
    return { id: user.id, name, role };
  };
  ada = await person('ada@example.com', 'Ada', 'editor');
  bob = await person('bob@example.com', 'Bob', 'editor');
  root = await person('root@example.com', 'Root', 'admin');
  threadId = services.threads.create(ada.id).id;
  dashboardId = services.dashboards.create(eventsSpec(), 'first', ada.id).id;
  services.threads.attachDashboard(threadId, dashboardId, 'Events');
  services.threads.apply(threadId, 'copied');
  await services.dashboards.pin(dashboardId, 1, ada.id);
  services.dashboards.addVersion(
    dashboardId,
    { ...eventsSpec(), title: 'Events v2' },
    'draft',
    ada.id,
  );
});

afterAll(async () => {
  await services.close();
  dataDir.remove();
});

/**
 * Sends a request as someone.
 *
 * @param principal - Who sends it.
 * @param method - The method.
 * @param path - The path under `/api`.
 * @param body - The JSON body, if any.
 * @returns The status and the body.
 */
async function as(principal: Principal, method: string, path: string, body?: unknown) {
  const app = createApp({
    version: 'test',
    authenticator: fixedAuthenticator(principal),
    logger: captureLogs().logger,
    webDir: dataDir.path,
    publicUrl: undefined,
    trustedProxyHops: 0,
    ...services,
  });
  const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'querent' };
  const init = { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
  const response = await app.request(`http://querent.test/api${path}`, init);
  return { status: response.status, body: (await response.json()) as unknown };
}

describe('a thread belongs to whoever started it', () => {
  test('its owner lists, reads and writes it', async () => {
    const listed = await as(ada, 'GET', '/threads');
    expect(listed.body).toMatchObject([{ id: threadId, ownerName: null }]);
    expect((await as(ada, 'GET', `/threads/${threadId}`)).body).toMatchObject({
      readOnly: false,
      ownerName: 'Ada',
    });
    expect((await as(ada, 'POST', `/threads/${threadId}/restore`, { version: 1 })).status).toBe(
      200,
    );
  });

  test('another editor finds nothing: not in the list, not by id, not by writing', async () => {
    expect((await as(bob, 'GET', '/threads')).body).toEqual([]);
    expect((await as(bob, 'GET', '/threads?scope=everyone')).body).toEqual([]);
    for (const [method, path, body] of [
      ['GET', `/threads/${threadId}`, undefined],
      ['POST', `/threads/${threadId}/restore`, { version: 1 }],
      ['POST', `/threads/${threadId}/plans/x/approve`, undefined],
      ['POST', `/threads/${threadId}/chat`, { message: {} }],
      ['DELETE', `/threads/${threadId}`, undefined],
    ] as const) {
      expect((await as(bob, method, path, body)).status).toBe(404);
    }
  });

  test('an admin reads it and sees it among everyone’s, but never writes in it', async () => {
    expect((await as(root, 'GET', '/threads')).body).toEqual([]);
    expect((await as(root, 'GET', '/threads?scope=everyone')).body).toMatchObject([
      { id: threadId, ownerName: 'Ada' },
    ]);
    expect((await as(root, 'GET', `/threads/${threadId}`)).body).toMatchObject({ readOnly: true });
    expect((await as(root, 'POST', `/threads/${threadId}/restore`, { version: 1 })).status).toBe(
      403,
    );
    expect((await as(root, 'POST', `/threads/${threadId}/chat`, { message: {} })).status).toBe(403);
  });

  test('a viewer has no threads at all', async () => {
    expect((await as(vera, 'GET', '/threads')).status).toBe(403);
  });
});

describe('a dashboard’s drafts follow its thread', () => {
  test('its owner and admins see every version; others only the pinned ones', async () => {
    const versionsOf = async (principal: Principal) => {
      const { body } = await as(principal, 'GET', `/dashboards/${dashboardId}`);
      return (body as { versions: { version: number }[] }).versions.map((each) => each.version);
    };
    expect(await versionsOf(ada)).toEqual([1, 2, 3]);
    expect(await versionsOf(root)).toEqual([1, 2, 3]);
    expect(await versionsOf(bob)).toEqual([1]);
    expect(await versionsOf(vera)).toEqual([1]);
    expect((await as(bob, 'GET', `/dashboards/${dashboardId}/versions/2`)).status).toBe(404);
    const run = { dashboardId, version: 2, panelId: 'errors-peak' };
    expect((await as(bob, 'POST', '/panels/run', run)).status).toBe(404);
    expect((await as(ada, 'POST', '/panels/run', run)).status).toBe(200);
  });

  test('tells each person what they may do with its thread', async () => {
    expect((await as(ada, 'GET', `/dashboards/${dashboardId}`)).body).toMatchObject({
      threadId,
      threadOfOther: false,
      canChange: true,
    });
    expect((await as(bob, 'GET', `/dashboards/${dashboardId}`)).body).toMatchObject({
      threadId: null,
      threadOfOther: true,
      canChange: false,
    });
    expect((await as(root, 'GET', `/dashboards/${dashboardId}`)).body).toMatchObject({
      threadId,
      canChange: true,
    });
  });

  test('only its owner and admins pin and unpin it; others copy its pinned version only', async () => {
    expect((await as(bob, 'POST', `/dashboards/${dashboardId}/unpin`)).status).toBe(403);
    expect((await as(bob, 'POST', `/dashboards/${dashboardId}/pin`, { version: 2 })).status).toBe(
      403,
    );
    const copy = (version: number) =>
      as(bob, 'POST', `/dashboards/${dashboardId}/threads`, { mode: 'copy', version });
    expect((await copy(2)).status).toBe(404);
    expect((await copy(1)).status).toBe(200);
    expect(
      (await as(bob, 'POST', `/dashboards/${dashboardId}/threads`, { mode: 'edit' })).status,
    ).toBe(400);
  });
});

describe('the bin keeps to owners', () => {
  test('an admin deletes someone’s thread; its owner and admins see it, others do not', async () => {
    await as(ada, 'POST', `/dashboards/${dashboardId}/unpin`);
    expect((await as(root, 'DELETE', `/threads/${threadId}`)).status).toBe(200);
    expect(((await as(ada, 'GET', '/bin')).body as { threads: unknown }).threads).toMatchObject([
      { id: threadId, ownerName: null },
    ]);
    expect(((await as(root, 'GET', '/bin')).body as { threads: unknown }).threads).toMatchObject([
      { id: threadId, ownerName: 'Ada' },
    ]);
    expect(((await as(bob, 'GET', '/bin')).body as { threads: unknown }).threads).toEqual([]);
    expect((await as(bob, 'POST', `/bin/${threadId}/restore`)).status).toBe(404);
    expect((await as(ada, 'POST', `/bin/${threadId}/restore`)).status).toBe(200);
  });
});
