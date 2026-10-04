import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  connectorInputSchema,
  conversationSchema,
  dashboardDetailSchema,
  listBinnedConversationsEndpoint,
  type Principal,
  questionIdHeader,
} from '@quanthea/shared';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { z } from 'zod';
import { createAnswers } from '../../agent/answer.ts';
import { type ScriptedStep, scriptedStreamModel } from '../../agent/test/mock-model.ts';
import { eventsSpec } from '../../dashboards/test/events-spec.ts';
import { purgeExpired } from '../../jobs/purge.ts';
import {
  captureLogs,
  fixedAuthenticator,
  temporaryDir,
  testServices,
} from '../../test/fixtures.ts';
import type { AppEnv } from '../app-env.ts';
import { authenticate } from '../authenticate.ts';
import { handleErrors, handleNotFound } from '../error-handling.ts';
import { mountBinEndpoints } from './bin-routes.ts';
import { mountConversationBinEndpoints } from './conversation-bin-routes.ts';
import { mountDashboardEndpoints } from './dashboard-routes.ts';
import { mountQuestionEndpoints } from './question-routes.ts';

const admin: Principal = { id: 'admin-1', name: 'Ada', role: 'admin' };
const editor: Principal = { id: 'editor-1', name: 'Eddie', role: 'editor' };
const analyst: Principal = { id: 'analyst-1', name: 'Ana', role: 'analyst' };
const otherAnalyst: Principal = { id: 'analyst-2', name: 'Otto', role: 'analyst' };
const viewer: Principal = { id: 'viewer-1', name: 'Vera', role: 'viewer' };

/** The names the fake users service knows. */
const names: Readonly<Record<string, string>> = {
  'admin-1': 'Ada',
  'analyst-1': 'Ana',
  'analyst-2': 'Otto',
  'editor-1': 'Eddie',
};

/** Validates a list of conversations. */
const conversationsSchema = z.object({ conversations: z.array(conversationSchema) });

/** Validates the binned conversations. */
const binnedSchema = listBinnedConversationsEndpoint.output;

let dataDir: ReturnType<typeof temporaryDir>;
let fixture: Awaited<ReturnType<typeof testServices>>;
let model: ReturnType<typeof scriptedStreamModel>;

/** A day, in milliseconds. */
const dayMs = 86_400_000;

beforeEach(async () => {
  dataDir = temporaryDir();
  fixture = await testServices(dataDir.path);
  model = scriptedStreamModel();
  const input = { name: 'events', kind: 'memory', config: {}, secret: { token: 't' } };
  await fixture.connections.create(
    connectorInputSchema.parse({ ...input, accessLevel: 3 }),
    'admin-1',
  );
});

afterEach(async () => {
  await fixture.close();
  dataDir.remove();
});

/**
 * An app with the dashboard, question and bin routes, acting as a principal.
 *
 * @param principal - Who the requests act as.
 * @returns A function that sends a JSON request and returns the status, the body and its headers.
 */
function client(principal: Principal) {
  const app = new Hono<AppEnv>();
  app.use(requestId());
  app.use(authenticate(fixedAuthenticator(principal)));
  const ownerOf = fixture.bin.ownerOf;
  mountDashboardEndpoints(app, fixture.dashboards, { ownerOf });
  const answers = createAnswers({ ...fixture, buildModel: () => model });
  const users = { nameOf: (id: string) => Promise.resolve(names[id]) };
  mountQuestionEndpoints(app, { questions: fixture.questions, answers, users, ownerOf });
  mountBinEndpoints(app, { ...fixture, users });
  mountConversationBinEndpoints(app, { ...fixture, users, ownerOf });
  app.onError(handleErrors(captureLogs().logger));
  app.notFound(handleNotFound);
  return async (method: string, path: string, body?: unknown) => {
    const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'quanthea' };
    const init =
      body === undefined ? { method, headers } : { method, headers, body: JSON.stringify(body) };
    const response = await app.request(path, init);
    const text = await response.text();
    const json = response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text;
    return { status: response.status, body: json as unknown, headers: response.headers };
  };
}

/**
 * Makes the model answer from a script.
 *
 * @param steps - One answer per step.
 */
function script(...steps: ScriptedStep[]): void {
  model = scriptedStreamModel(...steps);
}

/** A checked answer that cites a panel. */
const panelAnswer = (text: string) => ({
  tool: 'give_answer',
  input: { text, citations: [{ n: 1, panelId: 'errors-over-time' }] },
});

/**
 * Creates the events dashboard as an editor, and pins its first version.
 *
 * @returns The dashboard id.
 */
async function pinnedDashboard(): Promise<string> {
  const asEditor = client(editor);
  const created = await asEditor('POST', '/api/dashboards', { spec: eventsSpec() });
  const { id } = dashboardDetailSchema.parse(created.body);
  await asEditor('POST', `/api/dashboards/${id}/pin`, { version: 1 });
  return id;
}

/**
 * Asks a question, starting a conversation or continuing one.
 *
 * @param principal - Who asks.
 * @param dashboardId - The dashboard.
 * @param question - The question, answered with the same words.
 * @param conversationId - The conversation it continues, if any.
 * @returns The status and the stored question's id.
 */
async function ask(
  principal: Principal,
  dashboardId: string,
  question: string,
  conversationId?: string,
) {
  script(panelAnswer(`${question} Answered [1].`));
  const time = { from: '2026-10-03T12:00:00Z', to: '2026-10-03T13:00:00Z' };
  const body = { version: 1, question, time, timeZone: 'Europe/Zurich', conversationId };
  const asked = await client(principal)('POST', `/api/dashboards/${dashboardId}/questions`, body);
  return { status: asked.status, id: asked.headers.get(questionIdHeader) ?? '' };
}

/**
 * The conversations of a dashboard as a principal lists them.
 *
 * @param principal - Who lists them.
 * @param dashboardId - The dashboard.
 * @param search - The words to look for.
 * @returns The conversations.
 */
async function conversations(principal: Principal, dashboardId: string, search = '') {
  const query = search === '' ? '' : `?q=${encodeURIComponent(search)}`;
  const path = `/api/dashboards/${dashboardId}/conversations${query}`;
  return conversationsSchema.parse((await client(principal)('GET', path)).body).conversations;
}

/**
 * Moves a conversation to the bin as a principal.
 *
 * @param principal - Who bins it.
 * @param dashboardId - The dashboard.
 * @param conversationId - The conversation.
 * @returns The status.
 */
async function binAs(principal: Principal, dashboardId: string, conversationId: string) {
  const path = `/api/dashboards/${dashboardId}/conversations/${conversationId}`;
  return (await client(principal)('DELETE', path)).status;
}

/**
 * The bin of conversations as a principal sees it.
 *
 * @param principal - Who looks.
 * @returns The conversations and the retention.
 */
async function binned(principal: Principal) {
  return binnedSchema.parse((await client(principal)('GET', '/api/bin/conversations')).body);
}

describe('the bin of conversations', () => {
  test('its starter and admins bin a conversation; other analysts and viewers cannot', async () => {
    const id = await pinnedDashboard();
    const first = await ask(analyst, id, 'What happened around checkout?');
    const second = await ask(analyst, id, 'Why did latency rise?');
    expect(await conversations(analyst, id)).toEqual([
      expect.objectContaining({ id: second.id, canBin: true }),
      expect.objectContaining({ id: first.id, canBin: true }),
    ]);
    expect((await conversations(otherAnalyst, id)).map((each) => each.canBin)).toEqual([
      false,
      false,
    ]);
    expect((await conversations(admin, id)).every((each) => each.canBin)).toBe(true);
    expect((await conversations(viewer, id)).some((each) => each.canBin)).toBe(false);
    expect(await binAs(viewer, id, first.id)).toBe(403);
    expect(await binAs(otherAnalyst, id, first.id)).toBe(403);
    expect(await binAs(analyst, id, first.id)).toBe(200);
    expect(await binAs(admin, id, second.id)).toBe(200);
    expect(await binAs(analyst, id, first.id)).toBe(404);
    expect(await binAs(analyst, id, 'nope')).toBe(404);
    const read = await client(viewer)('GET', `/api/dashboards/${id}/conversations/${second.id}`);
    expect(read.status).toBe(409);
  });

  test('a binned conversation leaves the history, the search and the suggestions', async () => {
    const id = await pinnedDashboard();
    const kept = await ask(analyst, id, 'Is checkout latency fine?');
    const gone = await ask(analyst, id, 'What happened to checkout errors?');
    const followUp = await ask(analyst, id, 'And the payments deploy?', gone.id);
    expect(followUp.status).toBe(200);
    expect(await binAs(analyst, id, gone.id)).toBe(200);
    expect((await conversations(viewer, id)).map((each) => each.id)).toEqual([kept.id]);
    expect(await conversations(viewer, id, 'payments')).toEqual([]);
    expect((await conversations(viewer, id, 'checkout')).map((each) => each.id)).toEqual([kept.id]);
    const similar = await client(viewer)(
      'GET',
      `/api/dashboards/${id}/similar-questions?q=checkout`,
    );
    expect(similar.body).toEqual({ questions: [expect.objectContaining({ id: kept.id })] });
    const question = await client(viewer)('GET', `/api/dashboards/${id}/questions/${followUp.id}`);
    expect(question.status).toBe(404);
  });

  test('continuing a binned conversation is refused', async () => {
    const id = await pinnedDashboard();
    const started = await ask(analyst, id, 'What happened around 14:00?');
    await binAs(analyst, id, started.id);
    const continued = await ask(analyst, id, 'And then?', started.id);
    expect(continued.status).toBe(409);
  });

  test('the bin lists them to their starter, whoever binned them, and admins', async () => {
    const id = await pinnedDashboard();
    const started = await ask(analyst, id, 'What happened around 14:00?');
    await ask(analyst, id, 'And then?', started.id);
    const before = Date.now();
    await binAs(admin, id, started.id);
    const seen = await binned(analyst);
    expect(seen).toEqual({
      binDays: 30,
      conversations: [
        {
          id: started.id,
          dashboardId: id,
          dashboardTitle: eventsSpec().title,
          run: null,
          question: 'What happened around 14:00?',
          startedBy: 'Ana',
          startedAt: expect.any(Number),
          count: 2,
          binnedAt: expect.any(Number),
          binnedBy: 'Ada',
        },
      ],
    });
    expect(seen.conversations[0]?.binnedAt).toBeGreaterThanOrEqual(before);
    expect((await binned(admin)).conversations).toHaveLength(1);
    expect((await binned(otherAnalyst)).conversations).toEqual([]);
    expect((await binned(editor)).conversations).toEqual([]);
    expect((await client(viewer)('GET', '/api/bin/conversations')).status).toBe(403);
  });

  test('its starter, whoever binned it, and admins restore it; no one else', async () => {
    const id = await pinnedDashboard();
    const started = await ask(analyst, id, 'What happened around 14:00?');
    const restore = (principal: Principal) =>
      client(principal)('POST', `/api/bin/conversations/${started.id}/restore`);
    await binAs(admin, id, started.id);
    expect((await restore(otherAnalyst)).status).toBe(404);
    expect((await restore(viewer)).status).toBe(403);
    expect((await restore(analyst)).status).toBe(200);
    expect((await conversations(viewer, id)).map((each) => each.id)).toEqual([started.id]);
    expect((await restore(analyst)).status).toBe(404);
    await binAs(analyst, id, started.id);
    expect((await restore(admin)).status).toBe(200);
    const continued = await ask(analyst, id, 'And then?', started.id);
    expect(continued.status).toBe(200);
  });

  test('admins delete it for good; the usage stays', async () => {
    const id = await pinnedDashboard();
    const started = await ask(analyst, id, 'What happened around 14:00?');
    await ask(analyst, id, 'And then?', started.id);
    const spent = fixture.usage.month().tokens;
    expect(spent).toBeGreaterThan(0);
    await binAs(analyst, id, started.id);
    const purge = (principal: Principal) =>
      client(principal)('DELETE', `/api/bin/conversations/${started.id}`);
    expect((await purge(editor)).status).toBe(403);
    expect((await purge(admin)).status).toBe(200);
    expect((await purge(admin)).status).toBe(404);
    expect((await binned(admin)).conversations).toEqual([]);
    expect(fixture.usage.month().tokens).toBe(spent);
    const restored = await client(admin)('POST', `/api/bin/conversations/${started.id}/restore`);
    expect(restored.status).toBe(404);
  });

  test('emptying the bin deletes the binned conversations too', async () => {
    const id = await pinnedDashboard();
    const started = await ask(analyst, id, 'What happened around 14:00?');
    await binAs(analyst, id, started.id);
    expect((await client(admin)('DELETE', '/api/bin')).body).toEqual({ purged: 1 });
    expect((await binned(admin)).conversations).toEqual([]);
  });

  test('the hourly purge deletes those binned longer ago than the retention allows', async () => {
    const id = await pinnedDashboard();
    const old = await ask(analyst, id, 'What happened around 14:00?');
    const kept = await ask(analyst, id, 'Why did latency rise?');
    const spent = fixture.usage.month().tokens;
    await binAs(analyst, id, old.id);
    const { logger } = captureLogs();
    const purgeAfter = (days: number) =>
      purgeExpired({ ...fixture, logger, now: () => Date.now() + days * dayMs });
    expect(purgeAfter(29)).toBe(0);
    expect((await binned(analyst)).conversations.map((each) => each.id)).toEqual([old.id]);
    expect(purgeAfter(31)).toBe(1);
    expect((await binned(analyst)).conversations).toEqual([]);
    expect((await conversations(viewer, id)).map((each) => each.id)).toEqual([kept.id]);
    expect(fixture.usage.month().tokens).toBe(spent);
  });
});
