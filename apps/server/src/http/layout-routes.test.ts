import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { connectorInputSchema, type DashboardLayout, type Principal } from '@quanthea/shared';
import { createApp } from '../app.ts';
import { eventsSpec } from '../dashboards/test/events-spec.ts';
import { captureLogs, fixedAuthenticator, temporaryDir, testServices } from '../test/fixtures.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;
let ada: Principal;
let bob: Principal;
let root: Principal;
const vera: Principal = { id: 'viewer-1', name: 'Vera', role: 'viewer' };
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
  const threadId = services.threads.create(ada.id).id;
  dashboardId = services.dashboards.create(eventsSpec(), 'first', ada.id).id;
  services.threads.attachDashboard(threadId, dashboardId, 'Events');
  services.threads.apply(threadId, 'copied');
  await services.dashboards.pin(dashboardId, 1, ada.id);
  services.dashboards.addVersion(dashboardId, eventsSpec(), 'draft', ada.id);
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
  const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'quanthea' };
  const init = { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
  const response = await app.request(`http://quanthea.test/api${path}`, init);
  return { status: response.status, body: (await response.json()) as never };
}

/**
 * A layout of the events dashboard: the peak full width, the chart hidden or shown.
 *
 * @param chartHidden - Whether the chart over time is hidden.
 * @returns The layout.
 */
function layout(chartHidden: boolean): DashboardLayout {
  return {
    panels: [
      { id: 'errors-peak', grid: { x: 0, y: 0, w: 12, h: 3 }, hidden: false },
      { id: 'errors-over-time', grid: { x: 0, y: 3, w: 12, h: 6 }, hidden: chartHidden },
    ],
  };
}

/** The path of version 1's layouts. */
const layouts = () => `/dashboards/${dashboardId}/versions/1/layouts`;

describe('a pinned dashboard is arranged by hand', () => {
  test('only its thread owner and admins arrange it', async () => {
    const body = { layout: layout(true), basedOn: null };
    expect((await as(bob, 'POST', layouts(), body)).status).toBe(403);
    expect((await as(vera, 'POST', layouts(), body)).status).toBe(403);
    expect((await as(bob, 'GET', layouts())).status).toBe(403);
    const saved = await as(ada, 'POST', layouts(), body);
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ revision: 1, savedBy: 'Ada', restoredFrom: null });
    const next = await as(root, 'POST', layouts(), { layout: layout(false), basedOn: 1 });
    expect(next.body).toMatchObject({ revision: 2, savedBy: 'Root' });
  });

  test('a change based on an older revision is refused', async () => {
    const stale = await as(ada, 'POST', layouts(), { layout: layout(true), basedOn: 1 });
    expect(stale.status).toBe(409);
  });

  test('only the version shown takes a layout, and a layout names every panel once', async () => {
    const draft = `/dashboards/${dashboardId}/versions/2/layouts`;
    expect((await as(ada, 'POST', draft, { layout: layout(true), basedOn: null })).status).toBe(
      400,
    );
    const partial = { panels: layout(true).panels.slice(0, 1) };
    const refused = await as(ada, 'POST', layouts(), { layout: partial, basedOn: 2 });
    expect(refused.status).toBe(400);
  });

  test('restoring a revision adds one that copies it, and viewers see the latest', async () => {
    const restored = await as(ada, 'POST', `${layouts()}/1/restore`, { basedOn: 2 });
    expect(restored.body).toMatchObject({ revision: 3, restoredFrom: 1 });
    const history = await as(ada, 'GET', layouts());
    expect(
      (history.body as { revisions: { revision: number }[] }).revisions.map(
        (entry) => entry.revision,
      ),
    ).toEqual([3, 2, 1]);
    const shown = await as(vera, 'GET', `/dashboards/${dashboardId}/versions/1`);
    expect(shown.body).toMatchObject({ layout: { revision: 3, layout: layout(true) } });
    // The spec stays as it was: the layout changes how it is shown, never the version.
    expect((shown.body as { spec: { panels: unknown[] } }).spec.panels).toHaveLength(2);
  });

  test('a snapshot leaves the hidden panels out', async () => {
    const request = {
      dashboardId,
      version: 1,
      variables: {},
      hiddenMarkers: [],
      lifetime: '1d' as const,
    };
    const taken = await services.snapshots.take(request, 'viewer', vera.id);
    const { spec, panels } = services.snapshots.open(taken.id);
    expect(spec.panels.map((panel) => panel.id)).toEqual(['errors-peak']);
    expect(Object.keys(panels)).toEqual(['errors-peak']);
  });
});
