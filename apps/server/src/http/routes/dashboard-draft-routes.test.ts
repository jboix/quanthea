import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { connectorInputSchema, type Principal } from '@quanthea/shared';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { eventsSpec } from '../../dashboards/test/events-spec.ts';
import {
  captureLogs,
  fixedAuthenticator,
  temporaryDir,
  testServices,
} from '../../test/fixtures.ts';
import type { AppEnv } from '../app-env.ts';
import { authenticate } from '../authenticate.ts';
import { handleErrors, handleNotFound } from '../error-handling.ts';
import { mountDashboardDraftEndpoints } from './dashboard-draft-routes.ts';

const editor: Principal = { id: 'editor-1', name: 'Eddie', role: 'editor' };
const otherEditor: Principal = { id: 'editor-2', name: 'Olga', role: 'editor' };
const admin: Principal = { id: 'admin-1', name: 'Ada', role: 'admin' };
const analyst: Principal = { id: 'analyst-1', name: 'Ana', role: 'analyst' };

let dataDir: ReturnType<typeof temporaryDir>;
let fixture: Awaited<ReturnType<typeof testServices>>;
let threadId = '';
let dashboardId = '';

beforeEach(async () => {
  dataDir = temporaryDir();
  fixture = await testServices(dataDir.path);
  const events = { name: 'events', kind: 'memory', config: {}, secret: { token: 't' } };
  await fixture.connections.create(connectorInputSchema.parse(events), 'admin-1');
  threadId = fixture.threads.create('editor-1', null).id;
  dashboardId = fixture.dashboards.create(eventsSpec(), 'First', 'editor-1').id;
  fixture.threads.attachDashboard(threadId, dashboardId, 'Events');
});

afterEach(async () => {
  await fixture.close();
  dataDir.remove();
});

/**
 * An app with the hand edits' routes, acting as a principal.
 *
 * @param principal - Who the requests act as.
 * @returns A function that posts an edit of a panel, or its test run, and returns the answer.
 */
function client(principal: Principal) {
  const app = new Hono<AppEnv>();
  app.use(requestId());
  app.use(authenticate(fixedAuthenticator(principal)));
  mountDashboardDraftEndpoints(app, fixture);
  app.onError(handleErrors(captureLogs().logger));
  app.notFound(handleNotFound);
  return async (body: unknown, options: { panelId?: string; test?: boolean } = {}) => {
    const panel = options.panelId ?? 'errors-peak';
    const path = `/api/threads/${threadId}/dashboard-draft/panels/${panel}${options.test ? '/test' : ''}`;
    const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'quanthea' };
    const response = await app.request(path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
}

/**
 * The stat panel of the events spec, with changes.
 *
 * @param changes - The fields to change.
 * @returns The panel, as JSON.
 */
function stat(changes: Record<string, unknown> = {}) {
  const [panel] = eventsSpec().panels;
  if (!panel) throw new Error('The events spec has no stat.');
  return { ...panel, ...changes };
}

describe('a hand edit of a dashboard panel', () => {
  test('saves a new version and adds the card the agent reads', async () => {
    const response = await client(editor)({ basedOn: 1, panel: stat({ title: 'Peak errors' }) });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      dashboardId,
      version: 2,
      panels: [{ id: 'errors-peak', status: 'changed' }],
    });
    const saved = fixture.dashboards.getVersion(dashboardId, 2, 'editor');
    expect(saved.spec.panels[0]?.title).toBe('Peak errors');
    expect(saved.changeSummary).toBe('edited Peak errors by hand');
    const last = fixture.threads.get(threadId).messages.at(-1);
    expect(last).toMatchObject({
      role: 'user',
      parts: [{ type: 'data-dashboardHandEdit', data: { dashboardId, from: 1, to: 2 } }],
    });
  });

  test('keeps the panel’s id and its place unless the edit moves it', async () => {
    const { id: _, grid: __, ...rest } = stat({ id: 'renamed', title: 'Peak errors' });
    expect((await client(editor)({ basedOn: 1, panel: rest })).status).toBe(200);
    const saved = fixture.dashboards.getVersion(dashboardId, 2, 'editor').spec.panels[0];
    expect(saved).toMatchObject({ id: 'errors-peak', grid: { x: 0, y: 0, w: 4, h: 3 } });
  });

  test('test-runs a query without saving, and refuses to save one that fails', async () => {
    const call = client(editor);
    const query = { refId: 'A', connector: 'events', language: 'sql', sql: 'SELECT 1' };
    const broken = stat({ queries: [query] });
    const tried = await call({ basedOn: 1, panel: broken }, { test: true });
    expect(tried.status).toBe(200);
    expect(tried.body).toMatchObject({ ok: false, issues: [], queries: [{ refId: 'A', rows: 0 }] });
    expect((tried.body.queries as { error?: string }[])[0]?.error).toBeString();
    const working = await call({ basedOn: 1, panel: stat({ title: 'Peak' }) }, { test: true });
    expect(working.body).toMatchObject({ ok: true, issues: [] });
    expect((await call({ basedOn: 1, panel: broken })).status).toBe(400);
    expect(fixture.dashboards.get(dashboardId, 'editor').versions).toHaveLength(1);
  });

  test('points at the field a panel’s JSON gets wrong, inside the panel', async () => {
    const outcome = await client(editor)(
      { basedOn: 1, panel: stat({ view: { kind: 'stat', ref: 'A', reduce: 'often' } }) },
      { test: true },
    );
    const issues = outcome.body.issues as { path: string }[];
    expect(outcome.body.ok).toBe(false);
    expect(issues.some((issue) => issue.path.startsWith('view'))).toBe(true);
  });

  test('refuses a free colour, as the agent’s writes are refused', async () => {
    const chart = eventsSpec().panels[1];
    const option = { ...chart?.view.option, color: ['#ff0000'] };
    const panel = { ...chart, view: { ...chart?.view, option } };
    const outcome = await client(editor)(
      { basedOn: 1, panel },
      { panelId: 'errors-over-time', test: true },
    );
    expect(outcome.body.ok).toBe(false);
  });

  test('rebuilds the view from a chart picked from the recipes', async () => {
    const chart = { recipe: 'trend.line', variants: ['area'] };
    const panel = eventsSpec().panels[1];
    const response = await client(editor)(
      { basedOn: 1, panel, chart },
      { panelId: 'errors-over-time' },
    );
    expect(response.status).toBe(200);
    const saved = fixture.dashboards.getVersion(dashboardId, 2, 'editor').spec.panels[1];
    expect(saved?.view).toMatchObject({
      kind: 'chart',
      recipe: { id: 'trend.line', variants: ['area'] },
      markers: [{ annotation: 'events' }],
    });
  });

  test('refuses an edit that changes nothing, or that starts from an older version', async () => {
    const call = client(editor);
    expect((await call({ basedOn: 1, panel: stat() })).status).toBe(400);
    expect((await call({ basedOn: 1, panel: stat({ title: 'Peak' }) })).status).toBe(200);
    expect((await call({ basedOn: 1, panel: stat({ title: 'Top' }) })).status).toBe(409);
    expect((await call({ basedOn: 2, panel: stat() }, { panelId: 'nope' })).status).toBe(404);
  });

  test('is for the thread’s owner and admins', async () => {
    const edit = { basedOn: 1, panel: stat({ title: 'Peak' }) };
    expect((await client(otherEditor)(edit)).status).toBe(404);
    expect((await client(analyst)(edit)).status).toBe(403);
    expect((await client(admin)(edit)).status).toBe(200);
  });
});
