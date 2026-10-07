import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { connectorInputSchema, type Principal } from '@quanthea/shared';
import { createApp } from '../app.ts';
import { eventsSpec } from '../dashboards/test/events-spec.ts';
import { eventsReport } from '../reports/test/events-report.ts';
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
  const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'quanthea' };
  const init = { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
  const response = await app.request(`http://quanthea.test/api${path}`, init);
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

/** An alert spec over the in-memory events. */
const alertSpec = {
  specVersion: 1,
  title: 'Errors by service',
  query: { refId: 'A', connector: 'events', language: 'sql', sql: 'SELECT * FROM events' },
  value: { field: 'errors', by: ['service'], reduce: 'max' },
  condition: { kind: 'threshold', op: 'above', value: 4, for: '5m' },
  every: '1m',
  lookback: '10m',
  severity: 'warning',
  message: { title: '{alert}', body: '{series} at {value}.' },
};

/**
 * An alert of one of Ada's threads with an active first version and a draft second one, and an
 * alert of another of her threads with a draft only.
 *
 * @returns The two alerts.
 */
async function adasAlerts() {
  const save = (alertId?: string) => {
    const threadId = services.threads.create(ada.id, undefined, undefined, { kind: 'alert' }).id;
    return services.alerts.saveVersion({ alertId, spec: alertSpec, threadId }, ada.id).alertId;
  };
  const live = save();
  await services.alerts.activate(live, 1, ada.id);
  services.alerts.saveVersion({ alertId: live, spec: { ...alertSpec, title: 'v2' } }, ada.id);
  return { live, draft: save() };
}

/**
 * The version numbers of an alert or report someone reads, and whether they may change it.
 *
 * @param principal - Who reads it.
 * @param path - Its path under `/api`.
 * @returns The versions, the latest version and `canChange`.
 */
async function readAs(principal: Principal, path: string) {
  const { body } = await as(principal, 'GET', path);
  const { versions, latestVersion, canChange } = body as {
    versions: { version: number }[];
    latestVersion: number | null;
    canChange: boolean;
  };
  return { versions: versions.map((each) => each.version), latestVersion, canChange };
}

describe('an alert’s drafts follow its thread', () => {
  test('its owner and admins see every version; other editors only those ever active', async () => {
    const { live, draft } = await adasAlerts();
    const all = { versions: [2, 1], latestVersion: 2, canChange: true };
    expect(await readAs(ada, `/alerts/${live}`)).toEqual(all);
    expect(await readAs(root, `/alerts/${live}`)).toEqual(all);
    const active = { versions: [1], latestVersion: null, canChange: false };
    expect(await readAs(bob, `/alerts/${live}`)).toEqual(active);
    expect((await as(bob, 'GET', `/alerts/${draft}`)).status).toBe(404);
    const listed = async (principal: Principal) =>
      ((await as(principal, 'GET', '/alerts')).body as { alerts: { id: string }[] }).alerts.map(
        (each) => each.id,
      );
    expect(await listed(ada)).toContain(draft);
    expect(await listed(bob)).not.toContain(draft);
    const replay = { from: Date.now() - 3_600_000, to: Date.now() };
    expect((await as(bob, 'POST', `/alerts/${live}/versions/2/replay`, replay)).status).toBe(404);
  });

  test('only its owner and admins activate, deactivate, change or test it', async () => {
    const { live, draft } = await adasAlerts();
    const change = { basedOn: 1, spec: { ...alertSpec, severity: 'critical' } };
    for (const [method, path, body] of [
      ['POST', `/alerts/${draft}/activate`, { version: 1 }],
      ['POST', `/alerts/${live}/deactivate`, undefined],
      ['POST', `/alerts/${live}/versions`, change],
      ['POST', `/alerts/${live}/versions/2/test`, {}],
    ] as const) {
      expect((await as(bob, method, path, body)).status).toBe(403);
    }
    expect((await as(root, 'POST', `/alerts/${live}/deactivate`)).status).toBe(200);
    expect((await as(ada, 'POST', `/alerts/${draft}/activate`, { version: 1 })).status).toBe(200);
  });
});

/**
 * A report of one of Ada's threads with an active first version and a draft second one.
 *
 * @returns The report.
 */
async function adasReport(): Promise<string> {
  const threadId = services.threads.create(ada.id, undefined, undefined, { kind: 'report' }).id;
  const input = { spec: eventsReport(), threadId };
  const { reportId } = services.reports.saveVersion(input, ada.id);
  await services.reports.activate(reportId, 1, ada.id);
  services.reports.saveVersion({ reportId, spec: eventsReport({ title: 'v2' }) }, ada.id);
  return reportId;
}

describe('a report’s drafts follow its thread', () => {
  test('its owner and admins see every version; other editors only those ever active', async () => {
    const reportId = await adasReport();
    const all = { versions: [2, 1], latestVersion: 2, canChange: true };
    expect(await readAs(ada, `/reports/${reportId}`)).toEqual(all);
    expect(await readAs(root, `/reports/${reportId}`)).toEqual(all);
    const active = { versions: [1], latestVersion: null, canChange: false };
    expect(await readAs(bob, `/reports/${reportId}`)).toEqual(active);
  });

  test('only its owner and admins activate, deactivate, run or test it', async () => {
    const reportId = await adasReport();
    for (const [path, body] of [
      [`/reports/${reportId}/activate`, { version: 2 }],
      [`/reports/${reportId}/deactivate`, undefined],
      [`/reports/${reportId}/run`, { send: false }],
      [`/reports/${reportId}/versions/2/test`, undefined],
    ] as const) {
      expect((await as(bob, 'POST', path, body)).status).toBe(403);
    }
    expect((await as(root, 'POST', `/reports/${reportId}/deactivate`)).status).toBe(200);
  });

  test('other editors reach nothing of a run of a version never active', async () => {
    const threadId = services.threads.create(ada.id, undefined, undefined, { kind: 'report' }).id;
    const { reportId } = services.reports.saveVersion({ spec: eventsReport(), threadId }, ada.id);
    const run = await services.reports.runNow(reportId, false, ada.id);
    const base = `/reports/${reportId}/runs/${run.id}`;
    expect((await as(ada, 'GET', `${base}/sources`)).status).toBe(200);
    for (const [method, path, body] of [
      ['POST', `${base}/questions`, { question: 'Why?' }],
      ['GET', `${base}/sources`, undefined],
      ['GET', `${base}/conversations`, undefined],
      ['GET', `${base}/similar-questions?q=why`, undefined],
    ] as const) {
      expect((await as(bob, method, path, body)).status).toBe(404);
    }
  });
});
