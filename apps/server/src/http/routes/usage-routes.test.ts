import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { type Principal, usageReportSchema } from '@quanthea/shared';
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
import { mountUsageEndpoints } from './usage-routes.ts';

const admin: Principal = { id: 'admin-1', name: 'Ada', role: 'admin' };
const editor: Principal = { id: 'editor-1', name: 'Eddie', role: 'editor' };

let dataDir: ReturnType<typeof temporaryDir>;
let fixture: Awaited<ReturnType<typeof testServices>>;

beforeEach(async () => {
  dataDir = temporaryDir();
  fixture = await testServices(dataDir.path);
});

afterEach(async () => {
  await fixture.close();
  dataDir.remove();
});

/**
 * An app with the usage route, acting as a principal, with no users known.
 *
 * @param principal - Who the requests act as.
 * @returns A function that gets a path and returns the status and body.
 */
function client(principal: Principal) {
  const app = new Hono<AppEnv>();
  app.use(requestId());
  app.use(authenticate(fixedAuthenticator(principal)));
  mountUsageEndpoints(app, { usage: fixture.usage, users: { list: async () => [] } });
  app.onError(handleErrors(captureLogs().logger));
  app.notFound(handleNotFound);
  return async (path: string) => {
    const response = await app.request(path, { headers: { 'X-Requested-With': 'quanthea' } });
    return { status: response.status, body: (await response.json()) as unknown };
  };
}

const tokens = { input: 1000, cachedInput: 0, cacheWrite: 0, output: 100 };

describe('usage route', () => {
  test('gives admins the buckets by feature, with the fields they had before', async () => {
    const step = { provider: 'p', vendor: 'openai' as const, model: 'm', tokens };
    fixture.usage.recordStep({ ...step, threadId: null, job: 'metadata', feature: 'building' });
    const answer = { ...step, threadId: null, job: 'answer', userId: 'grace', dashboardId: 'd1' };
    fixture.usage.recordStep({ ...answer, feature: 'question' });
    fixture.usage.recordStep({ ...answer, feature: 'explanation' });
    fixture.usage.recordPinnedView('d1');
    expect((await client(editor)('/api/settings/usage?days=7')).status).toBe(403);
    const { status, body } = await client(admin)('/api/settings/usage?days=7');
    expect(status).toBe(200);
    const report = usageReportSchema.parse(body);
    const rows = report.buckets.map((bucket) => [bucket.kind, bucket.feature, bucket.events]);
    expect(rows).toEqual([
      ['model', 'building', 1],
      ['model', 'explanation', 1],
      ['model', 'question', 1],
      ['pinned_view', null, 1],
    ]);
    expect(report.buckets[0]).toMatchObject({ provider: 'p', model: 'm', input: 1000, userId: '' });
    expect(report.people).toEqual({ grace: { name: 'A removed user', role: null } });
  });
});
