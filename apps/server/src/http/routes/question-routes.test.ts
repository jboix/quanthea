import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  type AccessLevel,
  connectorInputSchema,
  dashboardDetailSchema,
  dashboardQuestionSchema,
  type Principal,
  questionIdHeader,
} from '@quanthea/shared';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { z } from 'zod';
import { createAnswers } from '../../agent/answer.ts';
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
import { mountQuestionEndpoints } from './question-routes.ts';

const editor: Principal = { id: 'editor-1', name: 'Eddie', role: 'editor' };
const analyst: Principal = { id: 'analyst-1', name: 'Ana', role: 'analyst' };
const viewer: Principal = { id: 'viewer-1', name: 'Vera', role: 'viewer' };

/** The names the fake users service knows. */
const names: Readonly<Record<string, string>> = { 'analyst-1': 'Ana', 'editor-1': 'Eddie' };

/** Validates a list of questions. */
const listSchema = z.object({ questions: z.array(dashboardQuestionSchema) });

let dataDir: ReturnType<typeof temporaryDir>;
let fixture: Awaited<ReturnType<typeof testServices>>;
/** The model answers come from; `undefined` builds the configured one, which has no key. */
let model: ReturnType<typeof scriptedStreamModel> | undefined;

beforeEach(async () => {
  dataDir = temporaryDir();
  fixture = await testServices(dataDir.path);
  model = scriptedStreamModel();
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
 * Makes the model answer from a script.
 *
 * @param script - One answer per step.
 */
function script(...steps: ScriptedStep[]): void {
  model = scriptedStreamModel(...steps);
}

/**
 * An app with the dashboard and question routes, acting as a principal.
 *
 * @param principal - Who the requests act as.
 * @returns A function that sends a JSON request and returns the status, the body and its headers.
 */
function client(principal: Principal) {
  const app = new Hono<AppEnv>();
  app.use(requestId());
  app.use(authenticate(fixedAuthenticator(principal)));
  mountDashboardEndpoints(app, fixture.dashboards, { ownerOf: fixture.bin.ownerOf });
  const scripted = model;
  const answers = createAnswers({
    ...fixture,
    ...(scripted ? { buildModel: () => scripted } : {}),
  });
  mountQuestionEndpoints(app, {
    questions: fixture.questions,
    answers,
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
    return { status: response.status, body: json as unknown, headers: response.headers };
  };
}

/**
 * Creates the events dashboard as an editor, pinned or as a draft.
 *
 * @param pinned - Whether to pin its first version.
 * @returns The dashboard id.
 */
async function eventsDashboard(pinned: boolean): Promise<string> {
  const asEditor = client(editor);
  const created = await asEditor('POST', '/api/dashboards', { spec: eventsSpec() });
  const { id } = dashboardDetailSchema.parse(created.body);
  if (pinned) await asEditor('POST', `/api/dashboards/${id}/pin`, { version: 1 });
  return id;
}

/**
 * A question about the first version over a fixed hour.
 *
 * @param question - The question.
 * @param parentId - The question it follows up on.
 * @returns The body.
 */
function asking(question: string, parentId?: string) {
  const time = { from: '2026-10-03T12:00:00Z', to: '2026-10-03T13:00:00Z' };
  const followUp = parentId === undefined ? {} : { parentId };
  return { version: 1, question, time, timeZone: 'Europe/Zurich', ...followUp };
}

/** A checked answer that cites a panel. */
const panelAnswer = (text: string) => ({
  tool: 'give_answer',
  input: { text, citations: [{ n: 1, panelId: 'errors-over-time' }] },
});

/**
 * The questions of a dashboard as a principal lists them.
 *
 * @param principal - Who lists them.
 * @param dashboardId - The dashboard.
 * @returns The questions.
 */
async function listed(principal: Principal, dashboardId: string) {
  const response = await client(principal)('GET', `/api/dashboards/${dashboardId}/questions`);
  return listSchema.parse(response.body).questions;
}

describe('question routes', () => {
  test('viewers read and search but cannot ask; analysts ask, and the answer is stored', async () => {
    await addEvents(3);
    const id = await eventsDashboard(true);
    const path = `/api/dashboards/${id}/questions`;
    expect((await client(viewer)('POST', path, asking('Any errors?'))).status).toBe(403);
    script(panelAnswer('Errors over time shows them [1].'));
    const asked = await client(analyst)('POST', path, asking('Any errors?'));
    expect(asked.status).toBe(200);
    expect(asked.body).toContain('"type":"data-outcome"');
    const [question] = await listed(viewer, id);
    expect(question).toMatchObject({
      id: asked.headers.get(questionIdHeader) ?? '',
      askedBy: 'Ana',
      version: 1,
      question: 'Any errors?',
      explainOnly: false,
      timeZone: 'Europe/Zurich',
      time: { from: Date.parse('2026-10-03T12:00:00Z'), to: Date.parse('2026-10-03T13:00:00Z') },
      variables: { env: 'prod', service: '$__all', order: 'A-1' },
      outcome: { ok: true, answer: { text: 'Errors over time shows them [1].' } },
      tokens: 15,
    });
    const one = await client(viewer)('GET', `${path}/${question?.id}`);
    expect(dashboardQuestionSchema.parse(one.body).question).toBe('Any errors?');
    const similar = await client(viewer)('GET', `/api/dashboards/${id}/similar-questions?q=errors`);
    expect(similar.body).toMatchObject({ questions: [{ id: question?.id, askedBy: 'Ana' }] });
  });

  test('stores a failed answer with its message', async () => {
    await addEvents(2);
    const id = await eventsDashboard(true);
    const wrong = { tool: 'give_answer', input: { text: 'Errors [1] [2].', citations: [] } };
    script(wrong, wrong);
    const asked = await client(analyst)('POST', `/api/dashboards/${id}/questions`, asking('Why?'));
    expect(asked.status).toBe(200);
    const [question] = await listed(viewer, id);
    expect(question).toMatchObject({ explainOnly: true, outcome: { ok: false, evidence: [] } });
    expect(question?.outcome.ok === false && question.outcome.message).toContain('did not hold up');
  });

  test('a follow-up passes its chain as history, and names its parent', async () => {
    await addEvents(3);
    const id = await eventsDashboard(true);
    const path = `/api/dashboards/${id}/questions`;
    script(panelAnswer('Errors rose at 12:30 [1].'));
    const first = await client(analyst)('POST', path, asking('What happened?'));
    const parentId = first.headers.get(questionIdHeader) ?? '';
    script(panelAnswer('A deploy went out [1].'));
    await client(analyst)('POST', path, asking('Why?', parentId));
    const prompt = JSON.stringify(model?.doStreamCalls[0]?.prompt);
    expect(prompt).toContain('What happened?');
    expect(prompt).toContain('Errors rose at 12:30 [1].');
    const [followUp] = await listed(viewer, id);
    expect(followUp).toMatchObject({ question: 'Why?', parentId });
    const elsewhere = await client(analyst)('POST', path, asking('Why?', 'nope'));
    expect(elsewhere.status).toBe(404);
  });

  test('only pinned dashboards take questions; viewers see none of an unpinned one', async () => {
    await addEvents(3);
    const id = await eventsDashboard(false);
    const asked = await client(editor)('POST', `/api/dashboards/${id}/questions`, asking('Hi?'));
    expect(asked.status).toBe(404);
    expect((await client(viewer)('GET', `/api/dashboards/${id}/questions`)).status).toBe(404);
  });

  test('without a model, asking fails before the stream and stores nothing', async () => {
    await addEvents(3);
    const id = await eventsDashboard(true);
    model = undefined;
    const asked = await client(analyst)('POST', `/api/dashboards/${id}/questions`, asking('Hi?'));
    expect(asked.status).toBe(400);
    expect(await listed(viewer, id)).toEqual([]);
  });

  test('the sources show names and access levels only', async () => {
    await addEvents(2);
    const id = await eventsDashboard(true);
    const response = await client(viewer)('GET', `/api/dashboards/${id}/versions/1/sources`);
    expect(response.body).toEqual({ sources: [{ name: 'events', accessLevel: 2 }] });
  });
});
