import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  alertDetailSchema,
  alertListItemSchema,
  alertReplaySchema,
  alertSummarySchema,
  connectorInputSchema,
  type Principal,
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
import { mountAlertEndpoints } from './alert-routes.ts';

const admin: Principal = { id: 'admin-1', name: 'Ada', role: 'admin' };
const editor: Principal = { id: 'editor-1', name: 'Eddie', role: 'editor' };
const analyst: Principal = { id: 'analyst-1', name: 'Ana', role: 'analyst' };
const viewer: Principal = { id: 'viewer-1', name: 'Vera', role: 'viewer' };

/** The names the fake users service knows. */
const names: Readonly<Record<string, string>> = { 'editor-1': 'Eddie', 'analyst-1': 'Ana' };

const hour = 3_600_000;
const day = 24 * hour;

let dataDir: ReturnType<typeof temporaryDir>;
let fixture: Awaited<ReturnType<typeof testServices>>;

beforeEach(async () => {
  dataDir = temporaryDir();
  fixture = await testServices(dataDir.path);
  const input = { name: 'events', kind: 'memory', config: {}, secret: { token: 't' } };
  await fixture.connections.create(connectorInputSchema.parse(input), 'admin-1');
});

afterEach(async () => {
  await fixture.close();
  dataDir.remove();
});

/**
 * A spec over the in-memory events: errors by service above 4.
 *
 * @param sql - The query.
 * @returns The spec.
 */
function eventsAlert(sql = 'SELECT * FROM events') {
  return {
    specVersion: 1,
    title: 'Errors by service',
    query: { refId: 'A', connector: 'events', language: 'sql', sql },
    value: { field: 'errors', by: ['service'], reduce: 'max' },
    condition: { kind: 'threshold', op: 'above', value: 4, for: '5m' },
    every: '1m',
    lookback: '10m',
    severity: 'warning',
    message: { title: '{alert}', body: '{series} at {value}.' },
  };
}

/**
 * An app with the alert routes, acting as a principal.
 *
 * @param principal - Who the requests act as.
 * @returns A function that sends a JSON request and returns the status and body.
 */
function client(principal: Principal) {
  const app = new Hono<AppEnv>();
  app.use(requestId());
  app.use(authenticate(fixedAuthenticator(principal)));
  mountAlertEndpoints(app, {
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
 * Saves an alert as an editor.
 *
 * @param sql - Its query.
 * @returns Its id.
 */
function saveAlert(sql?: string): string {
  return fixture.alerts.saveVersion({ spec: eventsAlert(sql) }, editor.id).alertId;
}

describe('reading alerts', () => {
  test('viewers see an alert once a version is active, with the versions ever active', async () => {
    const id = saveAlert();
    fixture.alerts.saveVersion({ alertId: id, spec: eventsAlert(), note: 'Draft' }, editor.id);
    expect((await client(viewer)('GET', '/api/alerts')).body).toEqual({ alerts: [] });
    expect((await client(viewer)('GET', `/api/alerts/${id}`)).status).toBe(404);
    expect(
      (await client(editor)('POST', `/api/alerts/${id}/activate`, { version: 1 })).status,
    ).toBe(200);
    const listed = await client(viewer)('GET', '/api/alerts');
    expect(listed.body.alerts).toMatchObject([{ id, activeVersion: 1, latestVersion: null }]);
    const detail = alertDetailSchema.parse((await client(viewer)('GET', `/api/alerts/${id}`)).body);
    expect(detail.latestVersion).toBeNull();
    expect(detail.versions.map((version) => [version.version, version.createdBy])).toEqual([
      [1, 'Eddie'],
    ]);
    const forEditors = alertDetailSchema.parse(
      (await client(editor)('GET', `/api/alerts/${id}`)).body,
    );
    expect(forEditors.latestVersion).toBe(2);
    expect(forEditors.versions.map((version) => version.version)).toEqual([2, 1]);
  });

  test('refuses a version that names a notification channel that does not exist', () => {
    const spec = { ...eventsAlert(), channels: ['nowhere'] };
    expect(() => fixture.alerts.saveVersion({ spec }, editor.id)).toThrow(
      expect.objectContaining({
        code: 'bad_request',
        details: [expect.objectContaining({ path: 'channels[0]' })],
      }),
    );
  });

  test('viewers and analysts change nothing but a mute', async () => {
    const id = saveAlert();
    for (const principal of [viewer, analyst]) {
      const send = client(principal);
      expect((await send('POST', `/api/alerts/${id}/activate`, { version: 1 })).status).toBe(403);
      expect((await send('POST', `/api/alerts/${id}/deactivate`)).status).toBe(403);
      const window = { spec: eventsAlert(), from: 0, to: hour };
      expect((await send('POST', '/api/alerts/replay', window)).status).toBe(403);
    }
    expect((await client(viewer)('POST', `/api/alerts/${id}/mute`, { until: null })).status).toBe(
      403,
    );
  });
});

describe('muting', () => {
  test('analysts mute up to seven days ahead, and unmute', async () => {
    const id = saveAlert();
    const send = client(analyst);
    const until = Date.now() + day;
    const muted = await send('POST', `/api/alerts/${id}/mute`, { until });
    expect(alertSummarySchema.parse(muted.body).muted).toMatchObject({ until, by: 'Ana' });
    expect((await send('POST', `/api/alerts/${id}/mute`, { until: null })).status).toBe(403);
    const tooFar = await send('POST', `/api/alerts/${id}/mute`, { until: Date.now() + 8 * day });
    expect(tooFar.status).toBe(400);
    const past = await send('POST', `/api/alerts/${id}/mute`, { until: Date.now() - hour });
    expect(past.status).toBe(400);
    expect((await send('POST', `/api/alerts/${id}/unmute`)).body.muted).toBeNull();
  });

  test('editors mute without an end', async () => {
    const id = saveAlert();
    const muted = await client(editor)('POST', `/api/alerts/${id}/mute`, { until: null });
    expect(muted.body.muted).toMatchObject({ until: null, by: 'Eddie' });
  });
});

describe('activating', () => {
  test('editors activate a version that runs, and deactivate it', async () => {
    const id = saveAlert();
    const send = client(editor);
    const active = await send('POST', `/api/alerts/${id}/activate`, { version: 1 });
    expect(active.body).toMatchObject({
      activeVersion: 1,
      deactivated: false,
      severity: 'warning',
    });
    expect(fixture.alerts.evaluated().map((each) => each.alert.id)).toEqual([id]);
    const stopped = await send('POST', `/api/alerts/${id}/deactivate`);
    expect(stopped.body).toMatchObject({ activeVersion: 1, deactivated: true });
    expect(fixture.alerts.evaluated()).toEqual([]);
  });

  test('refuses a version whose query fails, or an unknown version', async () => {
    const id = saveAlert('SELECT * FROM nowhere');
    const send = client(editor);
    const failed = await send('POST', `/api/alerts/${id}/activate`, { version: 1 });
    expect(failed.status).toBe(400);
    expect((await send('POST', `/api/alerts/${id}/activate`, { version: 9 })).status).toBe(404);
  });

  test('holds to the cap of active alerts per connector, which admins set', async () => {
    const saved = await client(admin)('PUT', '/api/settings/alerts', { maxActivePerConnector: 1 });
    expect(saved.body).toEqual({
      maxActivePerConnector: 1,
      notifyOnError: true,
      quietHours: null,
    });
    expect((await client(editor)('GET', '/api/settings/alerts')).status).toBe(403);
    const [first, second] = [saveAlert(), saveAlert()];
    const send = client(editor);
    expect((await send('POST', `/api/alerts/${first}/activate`, { version: 1 })).status).toBe(200);
    expect((await send('POST', `/api/alerts/${second}/activate`, { version: 1 })).status).toBe(409);
    expect((await send('POST', `/api/alerts/${first}/activate`, { version: 1 })).status).toBe(200);
  });

  test('counts an alert that compares with history twice towards the cap', async () => {
    await client(admin)('PUT', '/api/settings/alerts', { maxActivePerConnector: 3 });
    const condition = { kind: 'past', direction: 'up', amount: 30, unit: 'percent', ago: '1h' };
    const compared = () =>
      fixture.alerts.saveVersion(
        { spec: { ...eventsAlert(), condition: { ...condition, for: '0m' } } },
        editor.id,
      ).alertId;
    const send = client(editor);
    const activate = (id: string) => send('POST', `/api/alerts/${id}/activate`, { version: 1 });
    expect((await activate(compared())).status).toBe(200);
    const refused = await activate(compared());
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({
      error: { message: expect.stringContaining('run 2 queries per check') },
    });
    expect((await activate(saveAlert())).status).toBe(200);
    expect((await activate(saveAlert())).status).toBe(409);
  });

  test('counts the second query of a ratio on the connector it runs on', async () => {
    const totals = { name: 'totals', kind: 'memory', config: {}, secret: { token: 't' } };
    await fixture.connections.create(connectorInputSchema.parse(totals), 'admin-1');
    await client(admin)('PUT', '/api/settings/alerts', { maxActivePerConnector: 2 });
    const second = {
      refId: 'B',
      connector: 'totals',
      language: 'sql',
      sql: 'SELECT * FROM events',
    };
    const dividedBy = { query: second, field: 'errors', by: ['service'] };
    const condition = { kind: 'threshold', op: 'above', value: 2, for: '5m' };
    const ratio = () =>
      fixture.alerts.saveVersion({ spec: { ...eventsAlert(), dividedBy, condition } }, editor.id)
        .alertId;
    const activate = (id: string) =>
      client(editor)('POST', `/api/alerts/${id}/activate`, { version: 1 });
    expect((await activate(ratio())).status).toBe(200);
    expect((await activate(ratio())).status).toBe(200);
    const refused = await activate(ratio());
    expect(refused.status).toBe(409);
    const replay = await client(editor)('POST', '/api/alerts/replay', {
      spec: { ...eventsAlert(), dividedBy, condition },
      from: Date.now() - hour,
      to: Date.now(),
    });
    const replayed = alertReplaySchema.parse(replay.body);
    if (!replayed.replayable) throw new Error(replayed.reason);
    const readings = replayed.series.flatMap((each) => each.points.map((point) => point.readings));
    expect(readings.find((each) => each?.[0]?.value === 1)).toEqual([
      { value: 1, numerator: expect.any(Number), denominator: expect.any(Number) },
    ]);
  });
});

describe('replaying', () => {
  test('editors replay a draft spec and a saved version', async () => {
    const send = client(editor);
    const window = { from: Date.now() - 2 * hour, to: Date.now() - hour };
    const draft = await send('POST', '/api/alerts/replay', { spec: eventsAlert(), ...window });
    expect(alertReplaySchema.parse(draft.body)).toMatchObject({ replayable: true, stepMs: 60_000 });
    const id = saveAlert();
    const saved = await send('POST', `/api/alerts/${id}/versions/1/replay`, window);
    expect(saved.body.replayable).toBe(true);
  });

  test('refuses an invalid draft with its issues', async () => {
    const window = { from: 0, to: hour };
    const refused = await client(editor)('POST', '/api/alerts/replay', {
      spec: { ...eventsAlert(), every: '10s' },
      ...window,
    });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ error: { details: [{ part: 'spec', path: 'every' }] } });
  });
});

/**
 * A series as an evaluation leaves it.
 *
 * @param service - Its label.
 * @param state - Its state.
 * @param value - Its value.
 * @returns The series row.
 */
function seriesRow(service: string, state: 'ok' | 'firing', value: number) {
  return {
    key: `{service="${service}"}`,
    labels: { service },
    ...{ state, since: 5, value, lastSeenAt: 9, evaluatedAt: 9, notifiedAt: null },
    announced: false,
  };
}

describe('what the alert pages show', () => {
  test('viewers replay a version ever active, never a draft or a spec', async () => {
    const id = saveAlert();
    fixture.alerts.saveVersion({ alertId: id, spec: eventsAlert(), note: 'Draft' }, editor.id);
    const window = { from: Date.now() - 2 * hour, to: Date.now() - hour };
    const path = (version: number) => `/api/alerts/${id}/versions/${version}/replay`;
    expect((await client(viewer)('POST', path(1), window)).status).toBe(404);
    await client(editor)('POST', `/api/alerts/${id}/activate`, { version: 1 });
    const replayed = await client(viewer)('POST', path(1), window);
    expect(alertReplaySchema.parse(replayed.body).replayable).toBe(true);
    expect((await client(viewer)('POST', path(2), window)).status).toBe(404);
    expect((await client(editor)('POST', path(2), window)).status).toBe(200);
  });

  test('lists each alert with its condition and the series in the worst state', async () => {
    const id = saveAlert();
    await client(editor)('POST', `/api/alerts/${id}/activate`, { version: 1 });
    fixture.alertEvaluation.states.saveEvaluation(id, {
      evaluatedAt: 9,
      series: [
        seriesRow('cart', 'ok', 9),
        seriesRow('pay', 'firing', 6),
        seriesRow('web', 'firing', 8),
      ],
      removed: [],
      events: [],
    });
    const listed = (await client(viewer)('GET', '/api/alerts')).body.alerts as unknown[];
    expect(listed).toHaveLength(1);
    expect(alertListItemSchema.parse(listed[0])).toMatchObject({
      condition: { kind: 'threshold', op: 'above', value: 4, for: '5m' },
      format: null,
      lead: { labels: { service: 'web' }, state: 'firing', value: 8 },
      seriesCount: 3,
      states: { firing: 2, ok: 1 },
      lastNotification: null,
    });
  });

  test('names who activated and muted an alert, and lists its channels', async () => {
    const id = saveAlert();
    await client(editor)('POST', `/api/alerts/${id}/activate`, { version: 1 });
    const until = Date.now() + day;
    await client(analyst)('POST', `/api/alerts/${id}/mute`, { until });
    const detail = alertDetailSchema.parse((await client(viewer)('GET', `/api/alerts/${id}`)).body);
    expect(detail.timeline).toMatchObject({
      entries: [
        { type: 'activity', action: 'mute', by: 'Ana', version: null, until },
        { type: 'activity', action: 'activate', by: 'Eddie', version: 1, until: null },
      ],
      ...{ older: null, total: 2, offset: 0 },
    });
    const sends = { sends: [], older: null, total: 0, offset: 0 };
    expect(detail).toMatchObject({ channels: [], sends, lead: null, seriesCount: 0 });
  });
});
