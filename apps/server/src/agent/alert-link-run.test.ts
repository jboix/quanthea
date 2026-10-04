import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { connectorInputSchema, defaultModelGateway } from '@quanthea/shared';
import { eventsSpec } from '../dashboards/test/events-spec.ts';
import { temporaryDir, testServices } from '../test/fixtures.ts';
import { createAgent } from './run.ts';
import { type ScriptedStep, scriptedStreamModel } from './test/mock-model.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;
let dashboardId = '';

beforeEach(async () => {
  dataDir = temporaryDir();
  services = await testServices(dataDir.path);
  await services.modelSettings.save(defaultModelGateway, { anthropic: 'sk-test' }, 'admin-1');
  const input = { name: 'events', kind: 'memory', config: {}, secret: { token: 't' } };
  await services.connections.create(connectorInputSchema.parse(input), 'admin-1');
  dashboardId = services.dashboards.create(eventsSpec(), 'First', 'editor-1').id;
  await services.dashboards.pin(dashboardId, 1, 'editor-1');
});

afterEach(async () => {
  await services.close();
  dataDir.remove();
});

/** The whole alert, as the model writes it the first time, on the events dashboard's query. */
const alertEdit = {
  note: 'first draft',
  title: 'Errors by service',
  query: { connector: 'events', language: 'sql', sql: 'SELECT * FROM events' },
  value: { field: 'errors', reduce: 'max', by: ['service'] },
  condition: { kind: 'threshold', op: 'above', value: 5, for: '2m' },
  every: '1m',
  lookback: '10m',
  severity: 'warning',
  channels: [],
  message: { title: '{alert}: {series} at {value}', body: 'Above {threshold} since {since}.' },
};

/** The plan the model proposes. */
const plan = {
  title: 'Errors by service',
  watch: 'errors per service',
  connector: 'events',
  condition: 'above 5 for 2 minutes',
  every: 'every minute',
  channels: [],
};

/**
 * Sends a message to a thread with a model that answers from a script.
 *
 * @param threadId - The thread.
 * @param message - The message.
 * @param steps - The model's answers, one per step.
 * @returns The stream's text and the model.
 */
async function chat(threadId: string, message: unknown, ...steps: ScriptedStep[]) {
  const model = scriptedStreamModel(...steps);
  const agent = createAgent({ ...services, buildModel: () => model });
  const response = await agent.chat({
    threadId,
    message,
    actor: 'editor-1',
    signal: AbortSignal.timeout(5000),
  });
  return { text: await response.text(), model };
}

/**
 * Starts an alert thread, proposes the plan, approves it and writes the alert.
 *
 * @param seed - The panel it starts from, if any.
 * @returns The thread and its alert.
 */
async function writtenAlert(seed?: { dashboardId: string; version: number; panelId: string }) {
  const start = { kind: 'alert' as const, ...(seed ? { seed } : {}) };
  const { id: threadId } = services.threads.create('editor-1', null, undefined, start);
  const ask = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Errors?' }] };
  await chat(threadId, ask, { tool: 'propose_alert', input: plan });
  const [proposed] = services.threads.get(threadId).plans;
  services.threads.decidePlan(threadId, proposed?.id ?? '', 'approve', 'editor-1');
  const assistant = services.threads.get(threadId).messages[1] as { id: string };
  const continued = { id: assistant.id, role: 'assistant', parts: [] };
  await chat(threadId, continued, { tool: 'edit_alert', input: alertEdit }, { text: 'Written.' });
  return { threadId, alertId: services.threads.get(threadId).alertId ?? '' };
}

describe('an alert made from a panel', () => {
  test('links to that panel when it is first saved, and only then', async () => {
    const seed = { dashboardId, version: 1, panelId: 'errors-over-time' };
    const { threadId, alertId } = await writtenAlert(seed);
    const expected = [expect.objectContaining({ panelId: seed.panelId, how: 'from_panel' })];
    expect(services.panelLinks.forAlert(alertId, 'editor').links).toEqual(expected);
    const change = { note: 'higher', condition: { ...alertEdit.condition, value: 7 } };
    const ask = { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'Raise it' }] };
    await chat(threadId, ask, { tool: 'edit_alert', input: change }, { text: 'Raised.' });
    expect(services.panelLinks.forAlert(alertId, 'editor').links).toEqual(expected);
  });

  test('an alert from no panel links nowhere', async () => {
    const { alertId } = await writtenAlert();
    expect(services.panelLinks.forAlert(alertId, 'editor').links).toEqual([]);
  });
});

describe('propose_link', () => {
  test('reads the matching panels and proposes one as a card, linking nothing', async () => {
    const { threadId, alertId } = await writtenAlert();
    const ask = { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'Anything else?' }] };
    const target = { dashboardId, panelId: 'errors-over-time' };
    const { text, model } = await chat(
      threadId,
      ask,
      { tool: 'propose_link', input: target },
      { text: 'It could show there.' },
    );
    const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt);
    expect(prompt).toContain('panelId errors-over-time: \\"Errors over time\\" on \\"Events\\"');
    expect((model.doStreamCalls[0]?.tools ?? []).map((each) => each.name)).toContain(
      'propose_link',
    );
    expect(text).toContain('"type":"data-linkProposal"');
    expect(text).toContain('"panelTitle":"Errors over time"');
    expect(services.panelLinks.forAlert(alertId, 'editor').links).toEqual([]);
    services.panelLinks.link(alertId, { ...target, how: 'agent' }, 'editor-1');
    expect(services.panelLinks.forAlert(alertId, 'editor').links).toEqual([
      expect.objectContaining({ panelId: target.panelId, how: 'agent' }),
    ]);
    expect(services.panelLinks.candidates(alertId).map((each) => each.panelId)).not.toContain(
      target.panelId,
    );
  });

  test('refuses a panel that does not match', async () => {
    const { threadId } = await writtenAlert();
    const ask = { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'Link it' }] };
    const { text } = await chat(
      threadId,
      ask,
      { tool: 'propose_link', input: { dashboardId, panelId: 'nowhere' } },
      { text: 'No.' },
    );
    expect(text).toContain('That panel is not in the list');
    expect(text).not.toContain('data-linkProposal');
  });
});
