import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  binnedConversationSchema,
  connectorInputSchema,
  conversationSchema,
  type Principal,
  reportListItemSchema,
  reportRunSummarySchema,
  runQuestionSchema,
} from '@quanthea/shared';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { z } from 'zod';
import { createAnswers } from '../../agent/answer.ts';
import { type ScriptedStep, scriptedStreamModel } from '../../agent/test/mock-model.ts';
import {
  captureLogs,
  fixedAuthenticator,
  temporaryDir,
  testServices,
} from '../../test/fixtures.ts';
import type { AppEnv } from '../app-env.ts';
import { authenticate } from '../authenticate.ts';
import { handleErrors, handleNotFound } from '../error-handling.ts';
import { mountConversationBinEndpoints } from './conversation-bin-routes.ts';
import { mountReportEndpoints } from './report-routes.ts';
import { mountRunQuestionEndpoints } from './run-question-routes.ts';

const admin: Principal = { id: 'admin-1', name: 'Ada', role: 'admin' };
const editor: Principal = { id: 'editor-1', name: 'Eddie', role: 'editor' };
const analyst: Principal = { id: 'analyst-1', name: 'Ana', role: 'analyst' };
const viewer: Principal = { id: 'viewer-1', name: 'Vera', role: 'viewer' };

/** The names the fake users service knows. */
const names: Readonly<Record<string, string>> = {
  'admin-1': 'Ada',
  'editor-1': 'Eddie',
  'analyst-1': 'Ana',
};

let dataDir: ReturnType<typeof temporaryDir>;
let fixture: Awaited<ReturnType<typeof testServices>>;
let model: ReturnType<typeof scriptedStreamModel>;

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
 * An app with the report, run question and bin routes, acting as a principal.
 *
 * @param principal - Who the requests act as.
 * @returns A function that sends a JSON request and returns the status, the body and its headers.
 */
function client(principal: Principal) {
  const app = new Hono<AppEnv>();
  app.use(requestId());
  app.use(authenticate(fixedAuthenticator(principal)));
  const users = { nameOf: (id: string) => Promise.resolve(names[id]) };
  const answers = createAnswers({ ...fixture, buildModel: () => model });
  mountReportEndpoints(app, { ...fixture, users });
  mountRunQuestionEndpoints(app, { ...fixture, answers, users });
  mountConversationBinEndpoints(app, { ...fixture, users, ownerOf: fixture.bin.ownerOf });
  app.onError(handleErrors(captureLogs().logger));
  app.notFound(handleNotFound);
  return async (method: string, path: string, body?: unknown) => {
    const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'quanthea' };
    const init =
      body === undefined ? { method, headers } : { method, headers, body: JSON.stringify(body) };
    const response = await app.request(path, init);
    const text = await response.text();
    const json = response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text;
    return {
      status: response.status,
      body: json as Record<string, unknown>,
      headers: response.headers,
    };
  };
}

/**
 * A daily report over the in-memory events: the errors, summed.
 *
 * @returns The spec.
 */
function eventsReport() {
  const query = { refId: 'A', connector: 'events', language: 'sql', sql: 'SELECT * FROM events' };
  return {
    specVersion: 1,
    title: 'Daily errors',
    schedule: { every: 'day', at: '07:00', timezone: 'UTC' },
    period: 'previous_day',
    panels: [
      {
        id: 'errors',
        title: 'Errors',
        grid: { x: 0, y: 0, w: 3, h: 3 },
        queries: [query],
        view: {
          kind: 'stat',
          ref: 'A',
          field: 'errors',
          reduce: 'sum',
          format: { $fmt: 'number' },
        },
      },
    ],
    summaryPanels: ['errors'],
  };
}

/**
 * Saves and activates the report, and runs it now as an editor.
 *
 * @returns The report and the run.
 */
async function activeReportWithRun() {
  const reportId = fixture.reports.saveVersion({ spec: eventsReport() }, editor.id).reportId;
  await client(editor)('POST', `/api/reports/${reportId}/activate`, { version: 1 });
  const ran = await client(editor)('POST', `/api/reports/${reportId}/run`, { send: false });
  return { reportId, runId: reportRunSummarySchema.parse(ran.body).id };
}

/** An alert worth starting. */
const alertCard = {
  kind: 'alert',
  title: 'Error spike',
  prompt: 'Tell me when errors pass 50 in an hour.',
};

/**
 * Asks about a run, the model reading the frozen errors, proposing an alert and answering.
 *
 * @param principal - Who asks.
 * @param target - The report and the run.
 * @param target.reportId - The report.
 * @param target.runId - The run.
 * @param question - The question.
 * @param conversationId - The conversation it continues, if any.
 * @returns The status and the stored question's id.
 */
async function ask(
  principal: Principal,
  target: { reportId: string; runId: string },
  question: string,
  conversationId?: string,
) {
  const steps: ScriptedStep[] = [
    { tool: 'read_run', input: { panelId: 'errors' } },
    { tool: 'propose_follow_up', input: { cards: [alertCard] } },
    {
      tool: 'give_answer',
      input: { text: `${question} [1]`, citations: [{ n: 1, evidenceId: 'e1' }] },
    },
  ];
  model = scriptedStreamModel(...steps);
  const path = `/api/reports/${target.reportId}/runs/${target.runId}/questions`;
  const response = await client(principal)('POST', path, { question, conversationId });
  return { status: response.status, id: response.headers.get('X-Question-Id') ?? '' };
}

describe('the list for each person', () => {
  test('a run they have not opened is new; opening it marks it seen', async () => {
    const { reportId, runId } = await activeReportWithRun();
    const listOf = async (principal: Principal) =>
      z
        .array(reportListItemSchema)
        .parse((await client(principal)('GET', '/api/reports')).body.reports);
    expect((await listOf(viewer))[0]).toMatchObject({ id: reportId, unseen: true });
    await client(viewer)('GET', `/api/reports/${reportId}/runs/${runId}`);
    expect((await listOf(viewer))[0]?.unseen).toBe(false);
    expect((await listOf(analyst))[0]?.unseen).toBe(true);
    await client(editor)('POST', `/api/reports/${reportId}/run`, { send: false });
    const [again] = await listOf(viewer);
    expect(again?.unseen).toBe(true);
    expect(again?.history.map((point) => point.value)).toHaveLength(2);
    expect(again?.history[0]).toMatchObject({ runId, label: expect.any(String) });
  });
});

describe('questions about a run', () => {
  test('stored with the answer and its cards, read by every role, asked by analysts', async () => {
    const target = await activeReportWithRun();
    const base = `/api/reports/${target.reportId}/runs/${target.runId}`;
    expect((await ask(viewer, target, 'Why?')).status).toBe(403);
    const asked = await ask(analyst, target, 'Why so many errors?');
    expect(asked.status).toBe(200);
    const followed = await ask(analyst, target, 'And the day before?', asked.id);
    expect(followed.status).toBe(200);
    const listed = await client(viewer)('GET', `${base}/conversations`);
    const conversations = z.array(conversationSchema).parse(listed.body.conversations);
    expect(conversations).toMatchObject([
      { id: asked.id, count: 2, startedBy: 'Ana', canBin: false },
    ]);
    const read = await client(viewer)('GET', `${base}/conversations/${asked.id}`);
    const questions = z.array(runQuestionSchema).parse(read.body.questions);
    expect(questions.map((each) => each.question)).toEqual([
      'Why so many errors?',
      'And the day before?',
    ]);
    const [first] = questions;
    expect(first?.outcome).toMatchObject({ ok: true, answer: { followUps: [alertCard] } });
    expect(first?.outcome.ok && first.outcome.answer.evidence[0]?.frozen).toBe(true);
    const found = await client(viewer)('GET', `${base}/conversations?q=day+before`);
    expect(found.body.conversations).toMatchObject([
      { id: asked.id, match: { questionId: followed.id } },
    ]);
    const similar = await client(viewer)('GET', `${base}/similar-questions?q=errors`);
    expect(similar.body.questions).toMatchObject([{ id: asked.id }]);
    const sources = await client(viewer)('GET', `${base}/sources`);
    expect(sources.body).toEqual({ sources: [{ name: 'events', accessLevel: 3 }] });
  });

  test('the bin takes them out of History and continuing, and gives them back', async () => {
    const target = await activeReportWithRun();
    const base = `/api/reports/${target.reportId}/runs/${target.runId}`;
    const asked = await ask(analyst, target, 'Why so many errors?');
    expect((await client(viewer)('DELETE', `${base}/conversations/${asked.id}`)).status).toBe(403);
    expect((await client(editor)('DELETE', `${base}/conversations/${asked.id}`)).status).toBe(403);
    expect((await client(analyst)('DELETE', `${base}/conversations/${asked.id}`)).status).toBe(200);
    expect((await client(viewer)('GET', `${base}/conversations`)).body.conversations).toEqual([]);
    expect((await ask(analyst, target, 'More?', asked.id)).status).toBe(409);
    const binned = await client(analyst)('GET', '/api/bin/conversations');
    const [entry] = z.array(binnedConversationSchema).parse(binned.body.conversations);
    expect(entry).toMatchObject({
      id: asked.id,
      dashboardId: null,
      dashboardTitle: 'Daily errors',
      run: { reportId: target.reportId, runId: target.runId, period: expect.any(String) },
      startedBy: 'Ana',
      binnedBy: 'Ana',
    });
    const restore = `/api/bin/conversations/${asked.id}/restore`;
    expect((await client(analyst)('POST', restore)).status).toBe(200);
    expect((await client(viewer)('GET', `${base}/conversations`)).body.conversations).toHaveLength(
      1,
    );
    await client(analyst)('DELETE', `${base}/conversations/${asked.id}`);
    expect((await client(analyst)('DELETE', `/api/bin/conversations/${asked.id}`)).status).toBe(
      403,
    );
    expect((await client(admin)('DELETE', `/api/bin/conversations/${asked.id}`)).status).toBe(200);
    expect((await client(admin)('GET', '/api/bin/conversations')).body.conversations).toEqual([]);
  });

  test('an unknown run, or the run of a draft below editor, is not found', async () => {
    const reportId = fixture.reports.saveVersion({ spec: eventsReport() }, editor.id).reportId;
    const ran = await client(editor)('POST', `/api/reports/${reportId}/run`, { send: false });
    const draftRun = reportRunSummarySchema.parse(ran.body).id;
    expect((await ask(analyst, { reportId, runId: 'nope' }, 'Why?')).status).toBe(404);
    expect((await ask(analyst, { reportId, runId: draftRun }, 'Why?')).status).toBe(404);
    expect((await ask(editor, { reportId, runId: draftRun }, 'Why?')).status).toBe(200);
  });
});
