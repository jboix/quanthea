import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  connectorInputSchema,
  type DashboardLayout,
  type Principal,
  reportDetailSchema,
  reportRunDetailSchema,
  reportRunSummarySchema,
} from '@quanthea/shared';
import { createApp } from '../app.ts';
import { captureLogs, fixedAuthenticator, temporaryDir, testServices } from '../test/fixtures.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;
let ada: Principal;
let bob: Principal;
let root: Principal;
const vera: Principal = { id: 'viewer-1', name: 'Vera', role: 'viewer' };
let reportId = '';
let runId = '';

/**
 * A panel of the events report.
 *
 * @param id - Its id.
 * @param y - Its row.
 * @returns The panel, as JSON.
 */
function stat(id: string, y: number) {
  return {
    id,
    title: id,
    grid: { x: 0, y, w: 3, h: 3 },
    queries: [{ refId: 'A', connector: 'events', language: 'sql', sql: 'SELECT * FROM events' }],
    view: { kind: 'stat', ref: 'A', field: 'errors', reduce: 'sum', format: { $fmt: 'number' } },
  };
}

/** A daily report: one headline number, and two panels on its grid. */
const spec = {
  specVersion: 1,
  title: 'Daily errors',
  schedule: { every: 'day', at: '07:00', timezone: 'UTC' },
  period: 'previous_day',
  panels: [stat('errors', 0), stat('peak', 3), stat('mean', 6)],
  summaryPanels: ['errors'],
};

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
  reportId = services.reports.saveVersion({ spec, threadId }, ada.id).reportId;
});

afterAll(async () => {
  await services.close();
  dataDir.remove();
});

/**
 * A layout of the report's grid: the peak full width, the mean hidden or shown.
 *
 * @param meanHidden - Whether the mean is hidden.
 * @returns The layout.
 */
function layout(meanHidden: boolean): DashboardLayout {
  return {
    panels: [
      { id: 'peak', grid: { x: 0, y: 0, w: 12, h: 3 }, hidden: false },
      { id: 'mean', grid: { x: 0, y: 3, w: 6, h: 4 }, hidden: meanHidden },
    ],
  };
}

/** The path of version 1's layouts. */
const layouts = () => `/reports/${reportId}/versions/1/layouts`;

describe('an active report is arranged by hand', () => {
  test('a version that is not active takes no layout', async () => {
    const body = { layout: layout(true), basedOn: null };
    expect((await as(ada, 'POST', layouts(), body)).status).toBe(400);
    expect((await as(ada, 'POST', `/reports/${reportId}/activate`, { version: 1 })).status).toBe(
      200,
    );
    services.reports.saveVersion({ reportId, spec, note: 'Draft' }, ada.id);
    const draft = `/reports/${reportId}/versions/2/layouts`;
    expect((await as(ada, 'POST', draft, body)).status).toBe(400);
    expect((await as(ada, 'GET', `/reports/${reportId}/versions/9/layouts`)).status).toBe(404);
    const ran = await as(ada, 'POST', `/reports/${reportId}/run`, { send: false });
    runId = reportRunSummarySchema.parse(ran.body).id;
  });

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

  test('a stale change is refused, and a layout names the grid panels, never a headline', async () => {
    const stale = await as(ada, 'POST', layouts(), { layout: layout(true), basedOn: 1 });
    expect(stale.status).toBe(409);
    const headline = { id: 'errors', grid: { x: 0, y: 7, w: 3, h: 3 }, hidden: false };
    const withHeadline = { panels: [...layout(true).panels, headline] };
    const refused = await as(ada, 'POST', layouts(), { layout: withHeadline, basedOn: 2 });
    expect(refused.status).toBe(400);
    const partial = { panels: layout(true).panels.slice(0, 1) };
    expect((await as(ada, 'POST', layouts(), { layout: partial, basedOn: 2 })).status).toBe(400);
  });

  test('restoring adds a revision that copies one, and the history lists them', async () => {
    const restored = await as(ada, 'POST', `${layouts()}/1/restore`, { basedOn: 2 });
    expect(restored.body).toMatchObject({ revision: 3, restoredFrom: 1 });
    const history = await as(ada, 'GET', layouts());
    expect(
      (history.body as { revisions: { revision: number }[] }).revisions.map(
        (entry) => entry.revision,
      ),
    ).toEqual([3, 2, 1]);
  });

  test('a stored run and the report carry the layout of their version, for every role', async () => {
    const opened = await as(vera, 'GET', `/reports/${reportId}/runs/${runId}`);
    const run = reportRunDetailSchema.parse(opened.body);
    expect(run.layout).toEqual({ revision: 3, layout: layout(true) });
    // The version and the frozen results stay whole: the layout changes how they are shown.
    expect(run.spec.panels).toHaveLength(3);
    expect(Object.keys(run.panels ?? {}).sort()).toEqual(['errors', 'mean', 'peak']);
    const report = reportDetailSchema.parse((await as(ada, 'GET', `/reports/${reportId}`)).body);
    expect(report.versions.map((each) => [each.version, each.layout?.revision ?? null])).toEqual([
      [2, null],
      [1, 3],
    ]);
  });

  test('saving a layout is recorded, and makes no version', () => {
    const recorded = services.database
      .query<{ target: string }, []>("SELECT target FROM audit_log WHERE action = 'report.layout'")
      .all();
    expect(recorded).toEqual([{ target: reportId }, { target: reportId }, { target: reportId }]);
    expect(services.reports.get(reportId, 'admin').versions).toHaveLength(2);
  });
});
