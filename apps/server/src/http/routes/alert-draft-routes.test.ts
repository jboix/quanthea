import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { channelInputSchema, connectorInputSchema, type Principal } from '@quanthea/shared';
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
import { mountAlertDraftEndpoints } from './alert-draft-routes.ts';

const editor: Principal = { id: 'editor-1', name: 'Eddie', role: 'editor' };
const otherEditor: Principal = { id: 'editor-2', name: 'Olga', role: 'editor' };
const analyst: Principal = { id: 'analyst-1', name: 'Ana', role: 'analyst' };

let dataDir: ReturnType<typeof temporaryDir>;
let fixture: Awaited<ReturnType<typeof testServices>>;
let threadId = '';
let channelId = '';

/**
 * A spec over the in-memory events, notifying the test channel.
 *
 * @param value - The threshold.
 * @returns The spec, as JSON.
 */
function spec(value = 5): Record<string, unknown> {
  return {
    specVersion: 1,
    title: 'Checkout errors',
    query: { refId: 'A', connector: 'events', language: 'sql', sql: 'SELECT * FROM events' },
    value: { field: 'errors', reduce: 'max', by: ['service'] },
    condition: { kind: 'threshold', op: 'above', value, for: '2m' },
    every: '1m',
    lookback: '10m',
    severity: 'warning',
    channels: [channelId],
    message: { title: '{alert}: {series}', body: 'At {value}.' },
  };
}

beforeEach(async () => {
  dataDir = temporaryDir();
  fixture = await testServices(dataDir.path);
  const events = { name: 'events', kind: 'memory', config: {}, secret: { token: 't' } };
  await fixture.connections.create(connectorInputSchema.parse(events), 'admin-1');
  const channel = { name: 'On call', kind: 'webhook', target: 'http://127.0.0.1:9/hook' };
  channelId = (await fixture.notifications.create(channelInputSchema.parse(channel), 'admin-1')).id;
  threadId = fixture.threads.create('editor-1', null, undefined, { kind: 'alert' }).id;
});

afterEach(async () => {
  await fixture.close();
  dataDir.remove();
});

/**
 * An app with the draft pane's routes, acting as a principal.
 *
 * @param principal - Who the requests act as.
 * @returns A function that sends a JSON request and returns the status and body.
 */
function client(principal: Principal) {
  const app = new Hono<AppEnv>();
  app.use(requestId());
  app.use(authenticate(fixedAuthenticator(principal)));
  mountAlertDraftEndpoints(app, fixture);
  app.onError(handleErrors(captureLogs().logger));
  app.notFound(handleNotFound);
  return async (path: string, body: unknown) => {
    const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'quanthea' };
    const response = await app.request(path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
}

describe('a hand edit of an alert draft', () => {
  test('saves a new version and adds the card the agent reads', async () => {
    const { alertId } = fixture.alerts.saveVersion({ spec: spec(), threadId }, 'editor-1');
    const response = await client(editor)(`/api/threads/${threadId}/alert-draft`, {
      spec: spec(3),
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      alertId,
      version: 2,
      changes: [{ path: 'condition.value', before: '5', after: '3' }],
    });
    const [latest] = fixture.alerts.get(alertId, 'editor').versions;
    expect(latest).toMatchObject({ version: 2, note: 'By hand: condition.value' });
    const last = fixture.threads.get(threadId).messages.at(-1);
    expect(last).toMatchObject({
      role: 'user',
      parts: [{ type: 'data-handEdit', data: { alertId, from: 1, to: 2 } }],
    });
  });

  test('refuses an edit that changes nothing, or that does not validate', async () => {
    fixture.alerts.saveVersion({ spec: spec(), threadId }, 'editor-1');
    const call = client(editor);
    const path = `/api/threads/${threadId}/alert-draft`;
    expect((await call(path, { spec: spec() })).status).toBe(400);
    const broken = { ...spec(3), message: { title: '{nope}', body: 'x' } };
    expect((await call(path, { spec: broken })).status).toBe(400);
  });

  test('is for the thread’s owner, and only once it has a draft', async () => {
    const path = `/api/threads/${threadId}/alert-draft`;
    expect((await client(editor)(path, { spec: spec(3) })).status).toBe(400);
    fixture.alerts.saveVersion({ spec: spec(), threadId }, 'editor-1');
    expect((await client(otherEditor)(path, { spec: spec(3) })).status).toBe(404);
    expect((await client(analyst)(path, { spec: spec(3) })).status).toBe(403);
  });
});

describe('changes made on a live alert’s page', () => {
  /**
   * Saves an alert in the thread and activates its first version.
   *
   * @param thread - The thread that writes it, or `null` for none.
   * @returns The alert.
   */
  async function liveAlert(thread: string | null = threadId) {
    const input = { spec: spec(), ...(thread ? { threadId: thread } : {}) };
    const { alertId } = fixture.alerts.saveVersion(input, 'editor-1');
    await fixture.alerts.activate(alertId, 1, 'editor-1');
    return alertId;
  }

  test('are saved as a version, activated, and told to the conversation', async () => {
    const alertId = await liveAlert();
    // Another editor tunes it: the alert is no one's, the card goes to its conversation.
    const response = await client(otherEditor)(`/api/alerts/${alertId}/versions`, {
      basedOn: 1,
      spec: { ...spec(3), condition: { kind: 'threshold', op: 'above', value: 3, for: '5m' } },
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ alertId, version: 2 });
    expect((response.body.changes as { path: string }[]).map((each) => each.path)).toEqual([
      'condition.value',
      'condition.for',
    ]);
    const alert = fixture.alerts.get(alertId, 'editor');
    expect(alert.activeVersion).toBe(2);
    expect(alert.versions[0]).toMatchObject({
      version: 2,
      note: expect.stringContaining('By hand'),
    });
    const last = fixture.threads.get(threadId).messages.at(-1);
    expect(last).toMatchObject({
      role: 'user',
      parts: [{ type: 'data-handEdit', data: { alertId, from: 1, to: 2 } }],
    });
  });

  test('are for editors only', async () => {
    const alertId = await liveAlert();
    const path = `/api/alerts/${alertId}/versions`;
    const viewer: Principal = { id: 'viewer-1', name: 'Vic', role: 'viewer' };
    expect((await client(analyst)(path, { basedOn: 1, spec: spec(3) })).status).toBe(403);
    expect((await client(viewer)(path, { basedOn: 1, spec: spec(3) })).status).toBe(403);
    expect(fixture.alerts.get(alertId, 'editor').versions).toHaveLength(1);
  });

  test('refuse no change, an invalid spec, a failing query, or a stale version', async () => {
    const alertId = await liveAlert();
    const call = client(editor);
    const path = `/api/alerts/${alertId}/versions`;
    expect((await call(path, { basedOn: 1, spec: spec() })).status).toBe(400);
    const broken = { ...spec(3), message: { title: '{nope}', body: 'x' } };
    expect((await call(path, { basedOn: 1, spec: broken })).status).toBe(400);
    const failing = { ...spec(3), query: { ...(spec().query as object), sql: 'SELECT * FROM x' } };
    expect((await call(path, { basedOn: 1, spec: failing })).status).toBe(400);
    expect(fixture.alerts.get(alertId, 'editor').versions).toHaveLength(1);
    expect((await call(path, { basedOn: 1, spec: spec(3) })).status).toBe(200);
    expect((await call(path, { basedOn: 1, spec: spec(2) })).status).toBe(409);
    expect((await call('/api/alerts/nope/versions', { basedOn: 1, spec: spec(2) })).status).toBe(
      404,
    );
  });

  test('add no card for an alert without a conversation', async () => {
    const alertId = await liveAlert(null);
    const before = fixture.threads.get(threadId).messages.length;
    const response = await client(editor)(`/api/alerts/${alertId}/versions`, {
      basedOn: 1,
      spec: spec(3),
    });
    expect(response.status).toBe(200);
    expect(fixture.alerts.get(alertId, 'editor').activeVersion).toBe(2);
    expect(fixture.threads.get(threadId).messages).toHaveLength(before);
  });
});

describe('a test notification', () => {
  test('is for editors, and refused for a version that notifies no one', async () => {
    const quiet = { ...spec(), channels: [] };
    const { alertId } = fixture.alerts.saveVersion({ spec: quiet, threadId }, 'editor-1');
    const path = `/api/alerts/${alertId}/versions/1/test`;
    expect((await client(analyst)(path, {})).status).toBe(403);
    expect((await client(editor)(path, {})).status).toBe(400);
    expect((await client(editor)(`/api/alerts/${alertId}/versions/9/test`, {})).status).toBe(404);
  });
});
