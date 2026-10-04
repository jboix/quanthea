import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  alertLinksSchema,
  connectorInputSchema,
  dashboardAlertsSchema,
  type Principal,
} from '@quanthea/shared';
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
import { mountAlertLinkEndpoints } from './alert-link-routes.ts';

const admin: Principal = { id: 'admin-1', name: 'Ada', role: 'admin' };
const editor: Principal = { id: 'editor-1', name: 'Eddie', role: 'editor' };
const analyst: Principal = { id: 'analyst-1', name: 'Ana', role: 'analyst' };
const viewer: Principal = { id: 'viewer-1', name: 'Vera', role: 'viewer' };

let dataDir: ReturnType<typeof temporaryDir>;
let fixture: Awaited<ReturnType<typeof testServices>>;
/** The pinned events dashboard. */
let dashboardId: string;

beforeEach(async () => {
  dataDir = temporaryDir();
  fixture = await testServices(dataDir.path);
  const input = { name: 'events', kind: 'memory', config: {}, secret: { token: 't' } };
  await fixture.connections.create(connectorInputSchema.parse(input), 'admin-1');
  dashboardId = fixture.dashboards.create(eventsSpec(), 'First', editor.id).id;
  await fixture.dashboards.pin(dashboardId, 1, editor.id);
});

afterEach(async () => {
  await fixture.close();
  dataDir.remove();
});

/**
 * A spec over the in-memory events, with the events dashboard's query written another way.
 *
 * @param sql - The query.
 * @returns The spec.
 */
function eventsAlert(sql = 'SELECT *\n  FROM   events') {
  return {
    specVersion: 1,
    title: 'Errors by service',
    query: { refId: 'A', connector: 'events', language: 'sql', sql },
    value: { field: 'errors', by: ['service'], reduce: 'max' },
    variables: [{ name: 'env', value: 'prod' }],
    condition: { kind: 'threshold', op: 'above', value: 4, for: '5m' },
    every: '1m',
    lookback: '10m',
    severity: 'warning',
    message: { title: '{alert}', body: '{series} at {value}.' },
  };
}

/**
 * Saves an alert and activates it.
 *
 * @param sql - Its query.
 * @returns Its id.
 */
async function activeAlert(sql?: string): Promise<string> {
  const { alertId } = fixture.alerts.saveVersion({ spec: eventsAlert(sql) }, editor.id);
  await fixture.alerts.activate(alertId, 1, editor.id);
  return alertId;
}

/**
 * An app with the link routes, acting as a principal.
 *
 * @param principal - Who the requests act as.
 * @returns A function that sends a JSON request and returns the status and body.
 */
function client(principal: Principal) {
  const app = new Hono<AppEnv>();
  app.use(requestId());
  app.use(authenticate(fixedAuthenticator(principal)));
  mountAlertLinkEndpoints(app, fixture);
  app.onError(handleErrors(captureLogs().logger));
  app.notFound(handleNotFound);
  return async (method: string, path: string, body?: unknown) => {
    const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'quanthea' };
    const init = body === undefined ? { method } : { method, headers, body: JSON.stringify(body) };
    const response = await app.request(path, init);
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
}

/** The panel the tests link. */
const panelId = 'errors-over-time';

describe('linking by hand', () => {
  test('editors link and unlink a pinned panel, and the alert page lists it', async () => {
    const alertId = await activeAlert();
    const send = client(editor);
    const linked = await send('POST', `/api/alerts/${alertId}/links`, {
      dashboardId,
      panelId,
      how: 'by_hand',
    });
    expect(linked.status).toBe(200);
    const links = alertLinksSchema.parse(linked.body);
    expect(links.links).toEqual([
      expect.objectContaining({
        dashboardTitle: 'Events',
        panelId,
        panelTitle: 'Errors over time',
        version: 1,
        pinned: true,
        how: 'by_hand',
      }),
    ]);
    expect(links.suggestions.map((each) => each.panelId)).not.toContain(panelId);
    const path = `/api/alerts/${alertId}/links/${dashboardId}/${panelId}`;
    expect(alertLinksSchema.parse((await send('DELETE', path)).body).links).toEqual([]);
    expect((await send('DELETE', path)).status).toBe(404);
  });

  test('refuses a panel no pinned version has', async () => {
    const alertId = await activeAlert();
    const body = { dashboardId, panelId: 'nowhere', how: 'by_hand' };
    expect((await client(editor)('POST', `/api/alerts/${alertId}/links`, body)).status).toBe(404);
  });

  test('says when the version shown has no such panel', async () => {
    const alertId = await activeAlert();
    await client(editor)('POST', `/api/alerts/${alertId}/links`, {
      dashboardId,
      panelId,
      how: 'by_hand',
    });
    const spec = eventsSpec();
    const v2 = { ...spec, panels: spec.panels.filter((panel) => panel.id !== panelId) };
    fixture.dashboards.addVersion(dashboardId, v2, 'Without the chart', editor.id);
    await fixture.dashboards.pin(dashboardId, 2, editor.id);
    const links = alertLinksSchema.parse(
      (await client(viewer)('GET', `/api/alerts/${alertId}/links`)).body,
    );
    expect(links.links).toEqual([expect.objectContaining({ version: 2, panelTitle: null })]);
  });

  test('lists the pinned dashboards and their panels to editors only', async () => {
    const listed = await client(editor)('GET', '/api/alert-link-targets');
    expect(listed.body.dashboards).toEqual([
      expect.objectContaining({
        dashboardId,
        title: 'Events',
        panels: expect.arrayContaining([{ id: panelId, title: 'Errors over time' }]),
      }),
    ]);
    expect((await client(viewer)('GET', '/api/alert-link-targets')).status).toBe(403);
  });
});

describe('suggestions from matching queries', () => {
  test('suggest each pinned panel with the same query, on both sides, to editors', async () => {
    const alertId = await activeAlert();
    const links = alertLinksSchema.parse(
      (await client(editor)('GET', `/api/alerts/${alertId}/links`)).body,
    );
    expect(links.suggestions.map((each) => each.panelId).sort()).toEqual(
      eventsSpec()
        .panels.map((panel) => panel.id)
        .sort(),
    );
    const onDashboard = dashboardAlertsSchema.parse(
      (await client(editor)('GET', `/api/dashboards/${dashboardId}/alerts`)).body,
    );
    expect(onDashboard.suggestions).toContainEqual({ alertId, panelId });
    expect(onDashboard.alerts.map((alert) => alert.id)).toEqual([alertId]);
  });

  test('never suggest an alert whose query differs', async () => {
    const alertId = await activeAlert('SELECT * FROM "events"');
    const links = alertLinksSchema.parse(
      (await client(editor)('GET', `/api/alerts/${alertId}/links`)).body,
    );
    expect(links.suggestions).toEqual([]);
  });

  test('remember a dismissal, and show viewers no suggestion', async () => {
    const alertId = await activeAlert();
    const dismissed = await client(editor)('POST', `/api/alerts/${alertId}/link-dismissals`, {
      dashboardId,
      panelId,
    });
    const links = alertLinksSchema.parse(dismissed.body);
    expect(links.suggestions.map((each) => each.panelId)).not.toContain(panelId);
    expect(links.dismissed).toEqual([{ dashboardId, panelId }]);
    const forViewer = alertLinksSchema.parse(
      (await client(viewer)('GET', `/api/alerts/${alertId}/links`)).body,
    );
    expect(forViewer).toEqual({ links: [], suggestions: [], dismissed: [] });
    const onDashboard = dashboardAlertsSchema.parse(
      (await client(viewer)('GET', `/api/dashboards/${dashboardId}/alerts`)).body,
    );
    expect(onDashboard).toEqual({ alerts: [], links: [], suggestions: [] });
  });

  test('linking a suggestion makes it a link', async () => {
    const alertId = await activeAlert();
    const body = { dashboardId, panelId, how: 'query_match' };
    const links = alertLinksSchema.parse(
      (await client(editor)('POST', `/api/alerts/${alertId}/links`, body)).body,
    );
    expect(links.links).toEqual([expect.objectContaining({ panelId, how: 'query_match' })]);
    expect(links.suggestions.map((each) => each.panelId)).not.toContain(panelId);
  });
});

describe('access', () => {
  test('viewers and analysts read links but change none', async () => {
    const alertId = await activeAlert();
    for (const principal of [viewer, analyst]) {
      const send = client(principal);
      expect((await send('GET', `/api/alerts/${alertId}/links`)).status).toBe(200);
      expect((await send('GET', `/api/dashboards/${dashboardId}/alerts`)).status).toBe(200);
      const target = { dashboardId, panelId };
      const link = { ...target, how: 'by_hand' };
      expect((await send('POST', `/api/alerts/${alertId}/links`, link)).status).toBe(403);
      expect((await send('POST', `/api/alerts/${alertId}/link-dismissals`, target)).status).toBe(
        403,
      );
      const path = `/api/alerts/${alertId}/links/${dashboardId}/${panelId}`;
      expect((await send('DELETE', path)).status).toBe(403);
    }
    for (const principal of [editor, admin])
      expect((await client(principal)('GET', '/api/alert-link-targets')).status).toBe(200);
  });

  test('viewers see no link to an alert never activated', async () => {
    const { alertId } = fixture.alerts.saveVersion({ spec: eventsAlert() }, editor.id);
    fixture.panelLinks.link(alertId, { dashboardId, panelId, how: 'by_hand' }, editor.id);
    expect((await client(viewer)('GET', `/api/alerts/${alertId}/links`)).status).toBe(404);
    const onDashboard = dashboardAlertsSchema.parse(
      (await client(viewer)('GET', `/api/dashboards/${dashboardId}/alerts`)).body,
    );
    expect(onDashboard.links).toEqual([]);
    const forEditor = dashboardAlertsSchema.parse(
      (await client(editor)('GET', `/api/dashboards/${dashboardId}/alerts`)).body,
    );
    expect(forEditor.links).toEqual([{ alertId, panelId }]);
    expect(forEditor.alerts[0]).toMatchObject({ evaluated: false, threshold: null });
  });
});

describe('the alerts on a dashboard', () => {
  test('give the threshold, the fixed variables, the series and the firing periods', async () => {
    const alertId = await activeAlert();
    fixture.panelLinks.link(alertId, { dashboardId, panelId, how: 'by_hand' }, editor.id);
    const now = Date.now();
    const labels = { service: 'payments' };
    const event = { version: 1, seriesKey: 'p', labels, value: 5, message: null, notified: true };
    const series = {
      key: 'p',
      labels,
      state: 'firing' as const,
      since: now - 600_000,
      value: 5,
      lastSeenAt: now,
      evaluatedAt: now,
      notifiedAt: now,
      announced: true,
    };
    fixture.alertEvaluation.states.saveEvaluation(alertId, {
      evaluatedAt: now,
      series: [series],
      removed: [],
      events: [
        { ...event, id: 'e1', from: 'ok', to: 'firing', at: now - 3_000_000 },
        { ...event, id: 'e2', from: 'firing', to: 'ok', at: now - 2_400_000 },
        { ...event, id: 'e3', from: 'ok', to: 'firing', at: now - 600_000 },
      ],
    });
    const read = await client(viewer)('GET', `/api/dashboards/${dashboardId}/alerts?from=now-1h`);
    const alert = dashboardAlertsSchema.parse(read.body).alerts[0];
    expect(alert).toMatchObject({
      id: alertId,
      evaluated: true,
      muted: false,
      threshold: { op: 'above', value: 4 },
      variables: [{ name: 'env', value: 'prod' }],
      series: [{ labels, state: 'firing' }],
    });
    expect(alert?.periods).toEqual([
      { labels, from: now - 3_000_000, to: now - 2_400_000 },
      { labels, from: now - 600_000, to: null },
    ]);
    const recent = await client(viewer)(
      'GET',
      `/api/dashboards/${dashboardId}/alerts?from=now-15m`,
    );
    expect(dashboardAlertsSchema.parse(recent.body).alerts[0]?.periods).toEqual([
      { labels, from: now - 600_000, to: null },
    ]);
  });
});
