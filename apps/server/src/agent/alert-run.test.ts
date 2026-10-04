import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  channelInputSchema,
  connectorInputSchema,
  defaultModelGateway,
  type ThreadData,
} from '@quanthea/shared';
import { temporaryDir, testServices } from '../test/fixtures.ts';
import { type Agent, createAgent } from './run.ts';
import { type ScriptedStep, scriptedStreamModel } from './test/mock-model.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;
let threadId = '';
let channelId = '';

/**
 * Adds the in-memory events connector at an access level.
 *
 * @param accessLevel - The level.
 */
async function addEvents(accessLevel: number): Promise<void> {
  const input = { name: 'events', kind: 'memory', config: {}, secret: { token: 't' }, accessLevel };
  await services.connections.create(connectorInputSchema.parse(input), 'admin-1');
}

beforeEach(async () => {
  dataDir = temporaryDir();
  services = await testServices(dataDir.path);
  await services.modelSettings.save(defaultModelGateway, { anthropic: 'sk-test' }, 'admin-1');
  const channel = { name: 'On call', kind: 'webhook', target: 'http://127.0.0.1:9/hook' };
  channelId = (await services.notifications.create(channelInputSchema.parse(channel), 'admin-1'))
    .id;
  ({ id: threadId } = services.threads.create('editor-1', null, undefined, { kind: 'alert' }));
});

afterEach(async () => {
  await services.close();
  dataDir.remove();
});

/** An alert plan, as the model proposes it. */
function plan(channels: string[] = [channelId]) {
  return {
    title: 'Checkout errors',
    watch: 'errors per service',
    connector: 'events',
    condition: 'above 5 for 2 minutes',
    every: 'every minute',
    channels,
  };
}

/**
 * The whole alert, as the model writes it the first time.
 *
 * @param overrides - Fields to replace.
 * @returns The edit.
 */
function alertEdit(overrides: Record<string, unknown> = {}) {
  return {
    note: 'first draft',
    title: 'Checkout errors',
    query: { connector: 'events', language: 'sql', sql: 'SELECT * FROM events' },
    value: { field: 'errors', reduce: 'max', by: ['service'] },
    condition: { kind: 'threshold', op: 'above', value: 5, for: '2m' },
    every: '1m',
    lookback: '10m',
    severity: 'warning',
    channels: [channelId],
    message: { title: '{alert}: {series} at {value}', body: 'Above {threshold} since {since}.' },
    ...overrides,
  };
}

/**
 * An agent whose model answers from a script.
 *
 * @param steps - The model's answers, one per step.
 * @returns The agent and its model.
 */
function agentWith(...steps: ScriptedStep[]): {
  agent: Agent;
  model: ReturnType<typeof scriptedStreamModel>;
} {
  const model = scriptedStreamModel(...steps);
  const channels = () => services.notifications.picker();
  return { agent: createAgent({ ...services, channels, buildModel: () => model }), model };
}

/**
 * Sends a message and reads the whole stream.
 *
 * @param agent - The agent.
 * @param message - The message.
 * @returns The stream's text.
 */
async function chat(agent: Agent, message: unknown): Promise<string> {
  const response = await agent.chat({
    threadId,
    message,
    actor: 'editor-1',
    signal: AbortSignal.timeout(5000),
  });
  return response.text();
}

/**
 * A user message.
 *
 * @param id - Its id.
 * @param text - Its text.
 * @returns The message.
 */
function userMessage(id: string, text: string) {
  return { id, role: 'user', parts: [{ type: 'text', text }] };
}

/**
 * The names of the tools a model call offered.
 *
 * @param model - The model.
 * @param call - Which call.
 * @returns The names, sorted.
 */
function toolsOf(model: ReturnType<typeof scriptedStreamModel>, call = 0): string[] {
  return (model.doStreamCalls[call]?.tools ?? []).map((each) => each.name).sort();
}

/**
 * Proposes the plan and approves it, leaving the thread building.
 *
 * @returns The assistant message to continue.
 */
async function approvedThread(): Promise<{ id: string; role: string; parts: never[] }> {
  await chat(
    agentWith({ tool: 'propose_alert', input: plan() }).agent,
    userMessage('u1', 'Errors?'),
  );
  const [proposed] = services.threads.get(threadId).plans;
  services.threads.decidePlan(threadId, proposed?.id ?? '', 'approve', 'editor-1');
  const assistant = services.threads.get(threadId).messages[1] as { id: string };
  return { id: assistant.id, role: 'assistant', parts: [] };
}

/**
 * The data parts of a kind in the stored conversation.
 *
 * @param type - Such as `data-repair`.
 * @returns Their data.
 */
function stored<Name extends keyof ThreadData>(type: `data-${Name}`): ThreadData[Name][] {
  const messages = services.threads.get(threadId).messages as {
    parts: { type: string; data?: unknown }[];
  }[];
  return messages.flatMap((message) =>
    message.parts.flatMap((part) => (part.type === type ? [part.data as ThreadData[Name]] : [])),
  );
}

describe('an alert thread', () => {
  test('plans with the alert tools and instructions, never the dashboard ones', async () => {
    await addEvents(2);
    const { agent, model } = agentWith({ tool: 'propose_alert', input: plan() });
    const stream = await chat(agent, userMessage('u1', 'Tell me when checkout errors pass 5'));
    expect(toolsOf(model)).toEqual(['ask_person', 'describe', 'propose_alert', 'sample_values']);
    const system = JSON.stringify(model.doStreamCalls[0]?.prompt);
    expect(system).toContain('alert analyst');
    expect(system).toContain(`${channelId} (\\"On call\\", webhook)`);
    expect(system).not.toContain('dashboard analyst');
    expect(stream).toContain('"type":"data-alertPlan"');
    expect(services.threads.get(threadId).state).toBe('plan_pending');
  });

  test('proposes only channels from the list', async () => {
    await addEvents(2);
    const { agent } = agentWith(
      { tool: 'propose_alert', input: plan(['made-up']) },
      { text: 'Sorry.' },
    );
    const stream = await chat(agent, userMessage('u1', 'Errors?'));
    expect(stream).toContain('No channel \\"made-up\\"');
    expect(services.threads.get(threadId).plans).toEqual([]);
  });

  test('writes the approved alert as a draft version of the thread’s alert', async () => {
    await addEvents(2);
    const assistant = await approvedThread();
    const { agent, model } = agentWith(
      { tool: 'edit_alert', input: alertEdit() },
      { text: 'Written.' },
    );
    const stream = await chat(agent, assistant);
    expect(toolsOf(model)).toEqual([
      'describe',
      'edit_alert',
      'read_guide',
      'sample_values',
      'test_query',
    ]);
    const thread = services.threads.get(threadId);
    expect(thread).toMatchObject({ state: 'ready', title: 'Errors?' });
    expect(thread.alertId).not.toBeNull();
    const alert = services.alerts.get(thread.alertId ?? '', 'editor');
    expect(alert).toMatchObject({ threadId, activeVersion: null });
    expect(alert.versions.map((version) => version.note)).toEqual(['first draft']);
    expect(stored('data-alertVersion')).toEqual([
      { alertId: thread.alertId ?? '', version: 1, note: 'first draft' },
    ]);
    // Level 2 shows how many series and their label names, never values.
    expect(stream).toContain('"seriesCount":3');
    expect(stream).not.toContain('checkout-svc');
  });

  test('sends back the issues of a spec that does not validate, then repairs it', async () => {
    await addEvents(2);
    const assistant = await approvedThread();
    const broken = alertEdit({ message: { title: '{alert} {nope}', body: 'Body.' } });
    const { agent } = agentWith(
      { tool: 'edit_alert', input: broken },
      { tool: 'edit_alert', input: alertEdit() },
      { text: 'Fixed.' },
    );
    const stream = await chat(agent, assistant);
    expect(stream).toContain('message.title');
    expect(stored('data-repair').map((repair) => repair.outcome)).toEqual(['failed', 'repaired']);
    const { alertId } = services.threads.get(threadId);
    expect(services.alerts.get(alertId ?? '', 'editor').versions).toHaveLength(1);
  });

  test('refuses a channel that is not in the list', async () => {
    await addEvents(2);
    const assistant = await approvedThread();
    const { agent } = agentWith(
      { tool: 'edit_alert', input: alertEdit({ channels: ['made-up'] }) },
      { text: 'Stopped.' },
    );
    const stream = await chat(agent, assistant);
    expect(stream).toContain('channels[0]');
    expect(services.threads.get(threadId).alertId).toBeNull();
  });

  test('merges a later edit over the draft, field by field', async () => {
    await addEvents(2);
    const assistant = await approvedThread();
    await chat(
      agentWith({ tool: 'edit_alert', input: alertEdit() }, { text: 'Done.' }).agent,
      assistant,
    );
    const change = {
      note: 'higher',
      condition: { kind: 'threshold', op: 'above', value: 7, for: '2m' },
      value: { reduce: 'last' },
    };
    await chat(
      agentWith({ tool: 'edit_alert', input: change }, { text: 'Raised.' }).agent,
      userMessage('u2', 'Raise it to 7'),
    );
    const { alertId } = services.threads.get(threadId);
    const [latest] = services.alerts.get(alertId ?? '', 'editor').versions;
    expect(latest?.spec.condition).toEqual({ kind: 'threshold', op: 'above', value: 7, for: '2m' });
    expect(latest?.spec.value).toMatchObject({ field: 'errors', reduce: 'last', by: ['service'] });
    expect(latest?.spec.message.title).toBe('{alert}: {series} at {value}');
  });

  test('offers the replay only where the access level shows numbers', async () => {
    await addEvents(3);
    const assistant = await approvedThread();
    const { agent, model } = agentWith(
      { tool: 'edit_alert', input: alertEdit() },
      { tool: 'replay_alert', input: { window: '24h' } },
      { text: 'It would have fired.' },
    );
    const stream = await chat(agent, assistant);
    expect(toolsOf(model)).toContain('replay_alert');
    expect(stream).toContain('"seriesThatFired"');
    expect(stream).not.toContain('"points"');
  });

  test('reads the person’s hand edits in its next turn', async () => {
    await addEvents(2);
    const assistant = await approvedThread();
    await chat(
      agentWith({ tool: 'edit_alert', input: alertEdit() }, { text: 'Done.' }).agent,
      assistant,
    );
    const changes = [{ path: 'condition.value', before: '5', after: '3' }];
    const data = { alertId: 'a', from: 1, to: 2, changes };
    const card = { id: 'hand-1', role: 'user', parts: [{ type: 'data-handEdit', data }] };
    const { messages } = services.threads.get(threadId);
    services.threads.saveMessages(threadId, [...(messages as never[]), card], 'editor-1');
    const { agent, model } = agentWith({ text: 'Noted.' });
    await chat(agent, userMessage('u2', 'Is 3 too low?'));
    const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt);
    expect(prompt).toContain('I changed the alert by hand, v1 → v2] condition.value: 5 → 3');
  });

  test('counts its steps as building alerts in the usage ledger', async () => {
    await addEvents(2);
    await chat(
      agentWith({ tool: 'propose_alert', input: plan() }).agent,
      userMessage('u1', 'Errors?'),
    );
    const features = services.usage.report(1).buckets.map((bucket) => bucket.feature);
    expect(new Set(features)).toEqual(new Set(['alert']));
  });
});
