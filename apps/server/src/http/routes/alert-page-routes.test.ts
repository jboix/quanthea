import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  alertDetailSchema,
  alertSendsPageSchema,
  alertTimelinePageSchema,
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

const editor: Principal = { id: 'editor-1', name: 'Eddie', role: 'editor' };
const viewer: Principal = { id: 'viewer-1', name: 'Vera', role: 'viewer' };

let dataDir: ReturnType<typeof temporaryDir>;
let fixture: Awaited<ReturnType<typeof testServices>>;
let alertId: string;

/** A spec over the in-memory events: errors by service above 4. */
const spec = {
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

beforeEach(async () => {
  dataDir = temporaryDir();
  fixture = await testServices(dataDir.path);
  const input = { name: 'events', kind: 'memory', config: {}, secret: { token: 't' } };
  await fixture.connections.create(connectorInputSchema.parse(input), 'admin-1');
  alertId = fixture.alerts.saveVersion({ spec }, editor.id).alertId;
});

afterEach(async () => {
  await fixture.close();
  dataDir.remove();
});

/**
 * Reads a path as a principal.
 *
 * @param principal - Who asks.
 * @param path - The path under the alert, with its query.
 * @returns The status and the body.
 */
async function read(principal: Principal | null, path: string) {
  const app = new Hono<AppEnv>();
  app.use(requestId());
  app.use(authenticate(fixedAuthenticator(principal)));
  mountAlertEndpoints(app, {
    ...fixture,
    users: { nameOf: (id) => Promise.resolve(id === editor.id ? 'Eddie' : undefined) },
  });
  app.onError(handleErrors(captureLogs().logger));
  app.notFound(handleNotFound);
  const response = await app.request(`/api/alerts/${alertId}${path}`);
  return { status: response.status, body: (await response.json()) as unknown };
}

/**
 * Saves changes of state of the alert, one a millisecond from a start, the last held back by
 * quiet hours.
 *
 * @param count - How many.
 * @param from - The time of the first.
 */
function saveEvents(count: number, from: number): void {
  const events = Array.from({ length: count }, (_, index) => ({
    ...{ id: `e${from + index}`, version: 1, seriesKey: '{}', labels: {}, at: from + index },
    ...{ from: 'pending' as const, to: 'firing' as const, value: index, message: null },
    ...{ notified: index < count - 1, quiet: index === count - 1 },
  }));
  const record = { evaluatedAt: from + count, series: [], removed: [], events };
  fixture.alertEvaluation.states.saveEvaluation(alertId, record);
}

/**
 * Reads a page of the timeline as the editor.
 *
 * @param query - The query string.
 * @returns The page.
 */
async function timeline(query = '') {
  return alertTimelinePageSchema.parse((await read(editor, `/timeline${query}`)).body);
}

describe('the pages of what happened to an alert', () => {
  test('the detail carries the first page, and the cursor reads on to the end', async () => {
    saveEvents(24, 1000);
    const detail = alertDetailSchema.parse((await read(editor, '')).body);
    const first = detail.timeline;
    expect(first.entries.map((each) => each.at)).toEqual(
      Array.from({ length: 10 }, (_, index) => 1023 - index),
    );
    expect(first.entries[0]).toMatchObject({ type: 'event', notified: false, quiet: true });
    expect(first).toMatchObject({ total: 24, offset: 0, older: '1014:e1014' });
    expect(await timeline()).toEqual(first);
    const second = await timeline(`?before=${first.older}`);
    expect(second.entries.map((each) => each.at)).toEqual(
      Array.from({ length: 10 }, (_, index) => 1013 - index),
    );
    expect(second).toMatchObject({ total: 24, offset: 10 });
    const last = await timeline(`?before=${second.older}`);
    expect(last.entries).toHaveLength(4);
    expect(last).toMatchObject({ total: 24, offset: 20, older: null });
  });

  test('a cursor reads the same page once newer entries arrive, and says where it is', async () => {
    saveEvents(12, 1000);
    const first = await timeline('?limit=5');
    const second = await timeline(`?limit=5&before=${first.older}`);
    saveEvents(3, 2000);
    await fixture.alerts.activate(alertId, 1, editor.id);
    const again = await timeline(`?limit=5&before=${first.older}`);
    expect(again.entries).toEqual(second.entries);
    expect(again).toMatchObject({ total: 16, offset: 9, older: second.older });
    const latest = await timeline('?limit=5');
    expect(latest.entries[0]).toMatchObject({ type: 'activity', action: 'activate', by: 'Eddie' });
    expect(latest.entries.slice(1).map((each) => each.at)).toEqual([2002, 2001, 2000, 1011]);
  });

  test('an exact last page has no older cursor, and a limit of 50 is the most', async () => {
    saveEvents(10, 1000);
    expect(await timeline()).toMatchObject({ total: 10, older: null });
    expect((await read(editor, '/timeline?limit=51')).status).toBe(400);
    expect((await read(editor, '/timeline?before=yesterday')).status).toBe(400);
  });

  test('whoever reads the alert reads its pages, and no one else', async () => {
    saveEvents(2, 1000);
    for (const path of ['/timeline', '/sends']) {
      expect((await read(null, path)).status).toBe(401);
      expect((await read(viewer, path)).status).toBe(404);
      expect((await read(editor, path)).status).toBe(200);
    }
    await fixture.alerts.activate(alertId, 1, editor.id);
    expect((await read(viewer, '/timeline')).status).toBe(200);
    expect(alertSendsPageSchema.parse((await read(viewer, '/sends')).body)).toEqual({
      ...{ sends: [], older: null, total: 0, offset: 0 },
    });
  });
});
