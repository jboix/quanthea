import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  type AccessLevel,
  connectorInputSchema,
  dashboardDetailSchema,
  getPanelExplanationEndpoint,
  type Principal,
} from '@quanthea/shared';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { createAnswers } from '../../agent/answer.ts';
import type { AnswerRequest } from '../../agent/answer-types.ts';
import { type ScriptedStep, scriptedStreamModel } from '../../agent/test/mock-model.ts';
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
import { mountDashboardEndpoints } from './dashboard-routes.ts';
import { mountExplanationEndpoints } from './explanation-routes.ts';

const editor: Principal = { id: 'editor-1', name: 'Eddie', role: 'editor' };
const analyst: Principal = { id: 'analyst-1', name: 'Ana', role: 'analyst' };
const viewer: Principal = { id: 'viewer-1', name: 'Vera', role: 'viewer' };

/** The names the fake users service knows. */
const names: Readonly<Record<string, string>> = { 'analyst-1': 'Ana', 'editor-1': 'Eddie' };

/** The panel every test explains. */
const panelId = 'errors-over-time';

let dataDir: ReturnType<typeof temporaryDir>;
let fixture: Awaited<ReturnType<typeof testServices>>;
/** The model explanations come from; `undefined` builds the configured one, which has no key. */
let model: ReturnType<typeof scriptedStreamModel> | undefined;
/** Every request the answering service received. */
let requests: AnswerRequest[];

beforeEach(async () => {
  dataDir = temporaryDir();
  fixture = await testServices(dataDir.path);
  model = scriptedStreamModel();
  requests = [];
});

afterEach(async () => {
  await fixture.close();
  dataDir.remove();
});

/**
 * Adds the events connector at an access level.
 *
 * @param accessLevel - Its access level.
 */
async function addEvents(accessLevel: AccessLevel): Promise<void> {
  const input = { name: 'events', kind: 'memory', config: {}, secret: { token: 't' }, accessLevel };
  await fixture.connections.create(connectorInputSchema.parse(input), 'admin-1');
}

/**
 * Makes the model explain from a script.
 *
 * @param steps - One answer per step.
 */
function script(...steps: ScriptedStep[]): void {
  model = scriptedStreamModel(...steps);
}

/**
 * The answering service over the scripted model, recording each request it receives.
 *
 * @returns The service.
 */
function recordingAnswers() {
  const scripted = model;
  const answers = createAnswers({
    ...fixture,
    ...(scripted ? { buildModel: () => scripted } : {}),
  });
  return {
    stream: (request: AnswerRequest, onOutcome: Parameters<typeof answers.stream>[1]) => {
      requests.push(request);
      return answers.stream(request, onOutcome);
    },
  };
}

/**
 * An app with the dashboard and explanation routes, acting as a principal.
 *
 * @param principal - Who the requests act as.
 * @returns A function that sends a JSON request and returns the status and the body.
 */
function client(principal: Principal) {
  const app = new Hono<AppEnv>();
  app.use(requestId());
  app.use(authenticate(fixedAuthenticator(principal)));
  mountDashboardEndpoints(app, fixture.dashboards, { ownerOf: fixture.bin.ownerOf });
  mountExplanationEndpoints(app, {
    explanations: fixture.explanations,
    answers: recordingAnswers(),
    users: { nameOf: (id) => Promise.resolve(names[id]) },
    ownerOf: fixture.bin.ownerOf,
  });
  app.onError(handleErrors(captureLogs().logger));
  app.notFound(handleNotFound);
  return async (method: string, path: string, body?: unknown) => {
    const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'quanthea' };
    const init = body === undefined ? { method } : { method, headers, body: JSON.stringify(body) };
    const response = await app.request(path, init);
    const text = await response.text();
    const json = response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text;
    return { status: response.status, body: json as unknown };
  };
}

/**
 * Creates the events dashboard as an editor, pinned or as a draft.
 *
 * @param pinned - Whether to pin its first version.
 * @returns The path of its panel's explanation.
 */
async function eventsPanel(pinned: boolean): Promise<string> {
  const asEditor = client(editor);
  const created = await asEditor('POST', '/api/dashboards', { spec: eventsSpec() });
  const { id } = dashboardDetailSchema.parse(created.body);
  if (pinned) await asEditor('POST', `/api/dashboards/${id}/pin`, { version: 1 });
  return `/api/dashboards/${id}/versions/1/panels/${panelId}/explanation`;
}

/** An explanation as the model gives it. */
const explanation = (text: string) => ({ tool: 'give_answer', input: { text, citations: [] } });

/**
 * The latest explanation of the panel, as a principal reads it.
 *
 * @param principal - Who reads it.
 * @param path - The explanation's path.
 * @returns The explanation and whether one is being written.
 */
async function read(principal: Principal, path: string) {
  const response = await client(principal)('GET', path);
  return getPanelExplanationEndpoint.output.parse(response.body);
}

/**
 * How many times the model was called.
 *
 * @returns The count.
 */
function modelCalls(): number {
  return model?.doStreamCalls.length ?? 0;
}

describe('explanation routes', () => {
  test('viewers read but cannot ask; an analyst asks, and the explanation is stored', async () => {
    await addEvents(2);
    const path = await eventsPanel(true);
    expect(await read(viewer, path)).toEqual({ explanation: null, generating: false });
    expect((await client(viewer)('POST', path, { replaces: null })).status).toBe(403);
    script(explanation('It counts the errors per minute.'));
    const asked = await client(analyst)('POST', path, { replaces: null });
    expect(asked.status).toBe(200);
    expect(asked.body).toContain('"type":"data-outcome"');
    const { explanation: stored, generating } = await read(viewer, path);
    expect(generating).toBe(false);
    expect(stored).toMatchObject({
      version: 1,
      panelId,
      text: 'It counts the errors per minute.',
      explainedBy: 'Ana',
      tokens: 15,
    });
  });

  test('a stored explanation is read without a model call, and is not asked for twice', async () => {
    await addEvents(2);
    const path = await eventsPanel(true);
    script(explanation('It counts the errors per minute.'));
    await client(analyst)('POST', path, { replaces: null });
    const calls = modelCalls();
    expect(calls).toBe(1);
    expect((await read(viewer, path)).explanation?.text).toBe('It counts the errors per minute.');
    const twice = await client(analyst)('POST', path, { replaces: null });
    expect(twice.status).toBe(409);
    expect(JSON.stringify(twice.body)).toContain('explained meanwhile');
    expect(modelCalls()).toBe(calls);
  });

  test('explain again adds a new one, shown in place of the old', async () => {
    await addEvents(2);
    const path = await eventsPanel(true);
    script(explanation('First.'));
    await client(analyst)('POST', path, { replaces: null });
    const first = (await read(viewer, path)).explanation;
    script(explanation('Second.'));
    const again = await client(editor)('POST', path, { replaces: first?.id ?? null });
    expect(again.status).toBe(200);
    expect((await read(viewer, path)).explanation).toMatchObject({
      text: 'Second.',
      explainedBy: 'Eddie',
    });
    const kept = fixture.database.query<{ count: number }, []>(
      'SELECT count(*) AS count FROM panel_explanations',
    );
    expect(kept.get()?.count).toBe(2);
  });

  test('a panel being explained refuses a second request until the first ends', async () => {
    await addEvents(2);
    const path = await eventsPanel(true);
    const dashboardId = path.split('/')[3] ?? '';
    const key = { dashboardId, version: 1, panelId };
    const first = fixture.explanations.prepare(key, null, 'editor-1');
    expect((await read(viewer, path)).generating).toBe(true);
    const second = await client(analyst)('POST', path, { replaces: null });
    expect(second.status).toBe(409);
    expect(JSON.stringify(second.body)).toContain('being explained right now');
    expect(modelCalls()).toBe(0);
    fixture.explanations.release(first);
    script(explanation('It counts the errors.'));
    expect((await client(analyst)('POST', path, { replaces: null })).status).toBe(200);
  });

  test('the request carries the spec and the panel only, and reads no data', async () => {
    await addEvents(4);
    const path = await eventsPanel(true);
    script(explanation('It counts the errors per minute.'));
    await client(analyst)('POST', path, { replaces: null });
    expect(Object.keys(requests[0] ?? {}).sort()).toEqual([
      'actor',
      'dashboardId',
      'mode',
      'panelId',
      'signal',
      'spec',
    ]);
    expect(requests[0]).toMatchObject({ mode: 'explain', panelId, actor: 'analyst-1' });
    const tools = (model?.doStreamCalls[0]?.tools ?? []).map((tool) => tool.name);
    expect(tools).toContain('give_answer');
    expect(tools).not.toContain('read_data');
  });

  test('a failed explanation is not stored, and frees the panel', async () => {
    await addEvents(2);
    const path = await eventsPanel(true);
    const wrong = { tool: 'give_answer', input: { text: 'It counts [1] [2].', citations: [] } };
    script(wrong, wrong);
    const asked = await client(analyst)('POST', path, { replaces: null });
    expect(asked.status).toBe(200);
    expect(await read(viewer, path)).toEqual({ explanation: null, generating: false });
  });

  test('without a model, asking fails before the stream, stores nothing, frees the panel', async () => {
    await addEvents(2);
    const path = await eventsPanel(true);
    model = undefined;
    const asked = await client(analyst)('POST', path, { replaces: null });
    expect(asked.status).toBe(400);
    expect(await read(viewer, path)).toEqual({ explanation: null, generating: false });
  });

  test('only pinned versions are explained; unknown panels are not found', async () => {
    await addEvents(2);
    const draft = await eventsPanel(false);
    expect((await client(editor)('POST', draft, { replaces: null })).status).toBe(404);
    expect((await client(viewer)('GET', draft)).status).toBe(404);
    const pinned = await eventsPanel(true);
    const unknown = pinned.replace(panelId, 'nope');
    expect((await client(viewer)('GET', unknown)).status).toBe(404);
    expect((await client(analyst)('POST', unknown, { replaces: null })).status).toBe(404);
  });
});
