import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { connectorInputSchema, type Principal } from '@quanthea/shared';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { eventsReport } from '../../reports/test/events-report.ts';
import {
  captureLogs,
  fixedAuthenticator,
  temporaryDir,
  testServices,
} from '../../test/fixtures.ts';
import type { AppEnv } from '../app-env.ts';
import { authenticate } from '../authenticate.ts';
import { handleErrors, handleNotFound } from '../error-handling.ts';
import { mountReportDraftEndpoints } from './report-draft-routes.ts';

const editor: Principal = { id: 'editor-1', name: 'Eddie', role: 'editor' };
const otherEditor: Principal = { id: 'editor-2', name: 'Olga', role: 'editor' };
const analyst: Principal = { id: 'analyst-1', name: 'Ana', role: 'analyst' };

let dataDir: ReturnType<typeof temporaryDir>;
let fixture: Awaited<ReturnType<typeof testServices>>;
let threadId = '';

beforeEach(async () => {
  dataDir = temporaryDir();
  fixture = await testServices(dataDir.path);
  const events = { name: 'events', kind: 'memory', config: {}, secret: { token: 't' } };
  await fixture.connections.create(connectorInputSchema.parse(events), 'admin-1');
  threadId = fixture.threads.create('editor-1', null, undefined, { kind: 'report' }).id;
});

afterEach(async () => {
  await fixture.close();
  dataDir.remove();
});

/**
 * An app with the report draft pane's route, acting as a principal.
 *
 * @param principal - Who the requests act as.
 * @returns A function that sends a JSON request and returns the status and body.
 */
function client(principal: Principal) {
  const app = new Hono<AppEnv>();
  app.use(requestId());
  app.use(authenticate(fixedAuthenticator(principal)));
  mountReportDraftEndpoints(app, fixture);
  app.onError(handleErrors(captureLogs().logger));
  app.notFound(handleNotFound);
  return async (body: unknown) => {
    const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'quanthea' };
    const response = await app.request(`/api/threads/${threadId}/report-draft`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
}

/**
 * The weekly report on another weekday.
 *
 * @param weekday - The weekday.
 * @returns The spec, as JSON.
 */
function onWeekday(weekday: string) {
  return eventsReport({
    schedule: { every: 'week', weekday, at: '08:00', timezone: 'Europe/Zurich' },
  });
}

describe('a hand edit of a report draft', () => {
  test('saves a new version and adds the card the agent reads', async () => {
    const { reportId } = fixture.reports.saveVersion(
      { spec: eventsReport(), threadId },
      'editor-1',
    );
    const response = await client(editor)({ spec: onWeekday('friday') });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      reportId,
      version: 2,
      changes: [{ path: 'schedule.weekday', before: 'monday', after: 'friday' }],
    });
    const latest = fixture.reports
      .get(reportId, 'editor')
      .versions.find((each) => each.version === 2);
    expect(latest).toMatchObject({ note: 'By hand: schedule.weekday' });
    expect(latest?.spec.schedule).toMatchObject({ weekday: 'friday' });
    const last = fixture.threads.get(threadId).messages.at(-1);
    expect(last).toMatchObject({
      role: 'user',
      parts: [{ type: 'data-reportHandEdit', data: { reportId, from: 1, to: 2 } }],
    });
  });

  test('refuses an edit that changes nothing, or that does not validate', async () => {
    fixture.reports.saveVersion({ spec: eventsReport(), threadId }, 'editor-1');
    const call = client(editor);
    expect((await call({ spec: eventsReport() })).status).toBe(400);
    const broken = eventsReport({ period: 'previous_year' });
    expect((await call({ spec: broken })).status).toBe(400);
    const zone = eventsReport({
      schedule: { every: 'week', weekday: 'monday', at: '08:00', timezone: 'Mars/Olympus' },
    });
    expect((await call({ spec: zone })).status).toBe(400);
  });

  test('is for the thread’s owner, and only once it has a draft', async () => {
    expect((await client(editor)({ spec: onWeekday('friday') })).status).toBe(400);
    fixture.reports.saveVersion({ spec: eventsReport(), threadId }, 'editor-1');
    expect((await client(otherEditor)({ spec: onWeekday('friday') })).status).toBe(404);
    expect((await client(analyst)({ spec: onWeekday('friday') })).status).toBe(403);
  });
});
