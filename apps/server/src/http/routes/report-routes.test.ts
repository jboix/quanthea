import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  channelInputSchema,
  connectorInputSchema,
  type Principal,
  reportDetailSchema,
  reportPreviewSchema,
  reportRunDetailSchema,
  reportRunSummarySchema,
} from '@quanthea/shared';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import {
  captureLogs,
  fixedAuthenticator,
  temporaryDir,
  testServices,
} from '../../test/fixtures.ts';
import type { AppEnv } from '../app-env.ts';
import { authenticate } from '../authenticate.ts';
import { handleErrors, handleNotFound } from '../error-handling.ts';
import { mountReportEndpoints } from './report-routes.ts';

const admin: Principal = { id: 'admin-1', name: 'Ada', role: 'admin' };
const editor: Principal = { id: 'editor-1', name: 'Eddie', role: 'editor' };
const analyst: Principal = { id: 'analyst-1', name: 'Ana', role: 'analyst' };
const viewer: Principal = { id: 'viewer-1', name: 'Vera', role: 'viewer' };

/** The names the fake users service knows. */
const names: Readonly<Record<string, string>> = { 'editor-1': 'Eddie' };

let dataDir: ReturnType<typeof temporaryDir>;
let fixture: Awaited<ReturnType<typeof testServices>>;
/** A local receiver standing in for a webhook service, and what it received. */
let receiver: ReturnType<typeof Bun.serve>;
let received: { event: string | null; body: Record<string, unknown> }[];

beforeEach(async () => {
  dataDir = temporaryDir();
  fixture = await testServices(dataDir.path);
  const input = { name: 'events', kind: 'memory', config: {}, secret: { token: 't' } };
  await fixture.connections.create(connectorInputSchema.parse(input), 'admin-1');
  received = [];
  receiver = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: async (request) => {
      const body = (await request.json()) as Record<string, unknown>;
      received.push({ event: request.headers.get('x-quanthea-event'), body });
      return new Response('ok');
    },
  });
});

afterEach(async () => {
  await receiver.stop(true);
  await fixture.close();
  dataDir.remove();
});

/**
 * A daily report over the in-memory events: the errors, summed.
 *
 * @param channels - The channels it sends to.
 * @returns The spec.
 */
function eventsReport(channels: string[] = []) {
  return {
    specVersion: 1,
    title: 'Daily errors',
    schedule: { every: 'day', at: '07:00', timezone: 'UTC' },
    period: 'previous_day',
    panels: [
      {
        id: 'errors',
        title: 'Errors',
        grid: { x: 0, y: 0, w: 3, h: 3 },
        queries: [
          { refId: 'A', connector: 'events', language: 'sql', sql: 'SELECT * FROM events' },
        ],
        view: {
          kind: 'stat',
          ref: 'A',
          field: 'errors',
          reduce: 'sum',
          format: { $fmt: 'number' },
        },
      },
    ],
    summaryPanels: ['errors'],
    delivery: { channels },
  };
}

/**
 * An app with the report routes, acting as a principal.
 *
 * @param principal - Who the requests act as.
 * @returns A function that sends a JSON request and returns the status and body.
 */
function client(principal: Principal) {
  const app = new Hono<AppEnv>();
  app.use(requestId());
  app.use(authenticate(fixedAuthenticator(principal)));
  mountReportEndpoints(app, {
    ...fixture,
    users: { nameOf: (id) => Promise.resolve(names[id]) },
  });
  app.onError(handleErrors(captureLogs().logger));
  app.notFound(handleNotFound);
  return async (method: string, path: string, body?: unknown) => {
    const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'quanthea' };
    const init = body === undefined ? { method } : { method, headers, body: JSON.stringify(body) };
    const response = await app.request(path, init);
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
}

/**
 * Saves the report as an editor.
 *
 * @param channels - The channels it sends to.
 * @returns Its id.
 */
function saveReport(channels: string[] = []): string {
  return fixture.reports.saveVersion({ spec: eventsReport(channels) }, editor.id).reportId;
}

describe('reading reports', () => {
  test('viewers see a report once it is active, with the versions ever active', async () => {
    const id = saveReport();
    expect((await client(viewer)('GET', '/api/reports')).body).toEqual({ reports: [] });
    expect((await client(viewer)('GET', `/api/reports/${id}`)).status).toBe(404);
    const activated = await client(editor)('POST', `/api/reports/${id}/activate`, { version: 1 });
    expect(activated.status).toBe(200);
    expect(activated.body).toMatchObject({ activeVersion: 1, nextRunAt: expect.any(Number) });
    fixture.reports.saveVersion({ reportId: id, spec: eventsReport(), note: 'Draft' }, editor.id);
    const detail = reportDetailSchema.parse(
      (await client(viewer)('GET', `/api/reports/${id}`)).body,
    );
    expect(detail.latestVersion).toBeNull();
    expect(detail.versions.map((each) => [each.version, each.createdBy])).toEqual([[1, 'Eddie']]);
    const forEditors = reportDetailSchema.parse(
      (await client(editor)('GET', `/api/reports/${id}`)).body,
    );
    expect(forEditors.versions.map((each) => each.version)).toEqual([2, 1]);
  });

  test('runs open frozen for every role; the runs of a version never active stay hidden', async () => {
    const id = saveReport();
    const draft = reportRunSummarySchema.parse(
      (await client(editor)('POST', `/api/reports/${id}/run`, { send: false })).body,
    );
    fixture.reports.saveVersion({ reportId: id, spec: eventsReport() }, editor.id);
    await client(editor)('POST', `/api/reports/${id}/activate`, { version: 2 });
    const ran = await client(editor)('POST', `/api/reports/${id}/run`, { send: false });
    expect(ran.status).toBe(200);
    const run = reportRunSummarySchema.parse(ran.body);
    expect(run).toMatchObject({ trigger: 'manual', status: 'ok', startedBy: 'Eddie', version: 2 });
    expect(run.headlines).toMatchObject([{ panelId: 'errors', title: 'Errors' }]);
    const listed = await client(viewer)('GET', `/api/reports/${id}/runs`);
    expect((listed.body.runs as { id: string }[]).map((each) => each.id)).toEqual([run.id]);
    expect((await client(viewer)('GET', `/api/reports/${id}/runs/${draft.id}`)).status).toBe(404);
    const opened = await client(viewer)('GET', `/api/reports/${id}/runs/${run.id}`);
    const detail = reportRunDetailSchema.parse(opened.body);
    expect(Object.keys(detail.panels ?? {})).toEqual(['errors']);
    expect(detail).toMatchObject({ seeAlso: [], delivery: null, spec: { title: 'Daily errors' } });
    expect((await client(editor)('GET', `/api/reports/${id}/runs`)).body.runs).toHaveLength(2);
    const listedReports = await client(viewer)('GET', '/api/reports');
    expect(listedReports.body.reports).toMatchObject([{ id, lastRun: { id: run.id } }]);
  });
});

describe('changing and trying reports', () => {
  test('viewers and analysts change nothing and try nothing', async () => {
    const id = saveReport();
    for (const principal of [viewer, analyst]) {
      const send = client(principal);
      expect((await send('POST', `/api/reports/${id}/activate`, { version: 1 })).status).toBe(403);
      expect((await send('POST', `/api/reports/${id}/deactivate`)).status).toBe(403);
      expect((await send('POST', `/api/reports/${id}/run`, {})).status).toBe(403);
      expect((await send('POST', '/api/reports/preview', { spec: eventsReport() })).status).toBe(
        403,
      );
      expect((await send('POST', `/api/reports/${id}/versions/1/test`)).status).toBe(403);
    }
  });

  test('a preview runs a draft over its latest period and stores nothing', async () => {
    const previewed = await client(editor)('POST', '/api/reports/preview', {
      spec: eventsReport(),
    });
    expect(previewed.status).toBe(200);
    const preview = reportPreviewSchema.parse(previewed.body);
    expect(preview).toMatchObject({ failure: null, comparison: { label: expect.any(String) } });
    expect(preview.headlines).toHaveLength(1);
    expect(fixture.reports.list('editor', 'someone')).toEqual([]);
    const refused = await client(editor)('POST', '/api/reports/preview', {
      spec: { ...eventsReport(), summaryPanels: ['nothing'] },
    });
    expect(refused).toMatchObject({ status: 400, body: { error: { code: 'bad_request' } } });
  });

  test('a test of a version reaches its channels marked as a test', async () => {
    const channel = await fixture.notifications.create(
      channelInputSchema.parse({ name: 'Local', kind: 'webhook', target: receiver.url.href }),
      admin.id,
    );
    const id = saveReport([channel.id]);
    const sent = await client(editor)('POST', `/api/reports/${id}/versions/1/test`);
    expect(sent).toMatchObject({ status: 200, body: { results: [{ ok: true }] } });
    expect(received).toMatchObject([
      { event: 'report.ready', body: { test: true, report: { id }, run: { id: null } } },
    ]);
    expect(() => fixture.notifications.remove(channel.id, admin.id)).not.toThrow();
  });
});

describe('the report settings', () => {
  test('are for admins, and refuse a delay out of bounds', async () => {
    expect((await client(editor)('GET', '/api/settings/reports')).status).toBe(403);
    expect((await client(admin)('GET', '/api/settings/reports')).body).toEqual({
      maxRetries: 2,
      retryDelay: '15m',
      keepRunsDays: null,
    });
    const saved = { maxRetries: 1, retryDelay: '1h', keepRunsDays: 90 };
    expect((await client(admin)('PUT', '/api/settings/reports', saved)).body).toEqual(saved);
    const tooShort = { ...saved, retryDelay: '30s' };
    expect((await client(admin)('PUT', '/api/settings/reports', tooShort)).status).toBe(400);
  });
});
