import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { channelInputSchema, connectorInputSchema, defaultModelGateway } from '@quanthea/shared';
import { temporaryDir, testServices } from '../test/fixtures.ts';
import { alertGuide } from './alert-prompt.ts';
import { createAgent } from './run.ts';
import { type ScriptedStep, scriptedStreamModel } from './test/mock-model.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;
let threadId = '';
let channelId = '';

beforeEach(async () => {
  dataDir = temporaryDir();
  services = await testServices(dataDir.path);
  await services.modelSettings.save(defaultModelGateway, { anthropic: 'sk-test' }, 'admin-1');
  const channel = { name: 'On call', kind: 'webhook', target: 'http://127.0.0.1:9/hook' };
  channelId = (await services.notifications.create(channelInputSchema.parse(channel), 'admin-1'))
    .id;
  ({ id: threadId } = services.threads.create('editor-1', null, undefined, { kind: 'alert' }));
  // Five rows a minute apart: errors 0 and 6 for one service, 2 and 8 for another, 4 for a third.
  const events = { name: 'events', kind: 'memory', config: {}, secret: { token: 't' } };
  const input = connectorInputSchema.parse({ ...events, accessLevel: 2 });
  await services.connections.create(input, 'admin-1');
});

afterEach(async () => {
  await services.close();
  dataDir.remove();
});

/** A rise of the errors by 5 or more within 2 minutes. */
const rose = {
  kind: 'change',
  direction: 'up',
  amount: 5,
  unit: 'absolute',
  within: '2m',
  for: '0m',
};

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
    value: { field: 'errors', by: ['service'] },
    condition: rose,
    every: '1m',
    lookback: '10m',
    severity: 'warning',
    channels: [channelId],
    message: { title: '{alert}: {series}', body: '{change} from {previous} to {value}.' },
    ...overrides,
  };
}

/**
 * Sends a message to an agent whose model answers from a script, and reads the whole stream.
 *
 * @param message - The message.
 * @param steps - The model's answers, one per step.
 * @returns The stream's text.
 */
async function chat(message: unknown, ...steps: ScriptedStep[]): Promise<string> {
  const channels = () => services.notifications.picker();
  const buildModel = () => scriptedStreamModel(...steps);
  const agent = createAgent({ ...services, channels, buildModel });
  const signal = AbortSignal.timeout(5000);
  return (await agent.chat({ threadId, message, actor: 'editor-1', signal })).text();
}

/**
 * Proposes a plan and approves it, leaving the thread building.
 *
 * @returns The assistant message to continue.
 */
async function approvedThread(): Promise<{ id: string; role: string; parts: never[] }> {
  const plan = {
    title: 'Checkout errors',
    watch: 'errors per service',
    connector: 'events',
    condition: 'up by 5 within 2 minutes',
    every: 'every minute',
    channels: [channelId],
  };
  const asked = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Errors jumping?' }] };
  await chat(asked, { tool: 'propose_alert', input: plan });
  const [proposed] = services.threads.get(threadId).plans;
  services.threads.decidePlan(threadId, proposed?.id ?? '', 'approve', 'editor-1');
  const assistant = services.threads.get(threadId).messages[1] as { id: string };
  return { id: assistant.id, role: 'assistant', parts: [] };
}

/**
 * The condition of each version of the thread's alert, the latest first.
 *
 * @returns The conditions; none before the first version.
 */
function conditions(): unknown[] {
  const { alertId } = services.threads.get(threadId);
  if (alertId === null) return [];
  return services.alerts.get(alertId, 'editor').versions.map((each) => each.spec.condition);
}

describe('the alert agent and the kinds of condition', () => {
  test('writes a change, checked against the points of the window', async () => {
    const assistant = await approvedThread();
    const stream = await chat(
      assistant,
      { tool: 'edit_alert', input: alertEdit() },
      { text: 'Ok.' },
    );
    expect(conditions()).toEqual([rose]);
    expect(stream).toContain('"seriesCount":3');
  });

  test('is told when the window is not longer than the span of a change, and repairs it', async () => {
    const assistant = await approvedThread();
    const short = alertEdit({ condition: { ...rose, within: '10m' } });
    const stream = await chat(
      assistant,
      { tool: 'edit_alert', input: short },
      { tool: 'edit_alert', input: alertEdit({ lookback: '5m' }) },
      { text: 'Fixed.' },
    );
    expect(stream).toContain('Use a window longer than the change');
    expect(conditions()).toEqual([rose]);
  });

  test('is told when no series has a point as far back as the change looks', async () => {
    const assistant = await approvedThread();
    const far = alertEdit({ condition: { ...rose, within: '9m' } });
    const stream = await chat(assistant, { tool: 'edit_alert', input: far }, { text: 'Stopped.' });
    expect(stream).toContain('condition.within');
    expect(stream).toContain('No series has a point 9m before its latest one');
    expect(conditions()).toEqual([]);
  });

  test('writes tests joined on one query, each part on a column the result has', async () => {
    const assistant = await approvedThread();
    const above = { kind: 'threshold', op: 'above', value: 5 };
    const joined = (field: string) => ({
      kind: 'any',
      of: [above, { kind: 'threshold', op: 'above', value: 10, field, reduce: 'sum' }],
      for: '0m',
    });
    const message = { title: '{alert}: {series}', body: '{values}, {threshold}.' };
    const stream = await chat(
      assistant,
      { tool: 'edit_alert', input: alertEdit({ condition: joined('requests'), message }) },
      { tool: 'edit_alert', input: alertEdit({ condition: joined('errors'), message }) },
      { text: 'Fixed.' },
    );
    expect(stream).toContain('No column \\"requests\\".');
    expect(conditions()).toEqual([joined('errors')]);
  });

  test('refuses a first part with a field of its own, and nested tests', async () => {
    const assistant = await approvedThread();
    const above = { kind: 'threshold', op: 'above', value: 5 };
    const own = { kind: 'all', of: [{ ...above, field: 'errors' }, above], for: '0m' };
    const nested = { kind: 'all', of: [above, { kind: 'any', of: [above, above] }], for: '0m' };
    const stream = await chat(
      assistant,
      { tool: 'edit_alert', input: alertEdit({ condition: own }) },
      { tool: 'edit_alert', input: alertEdit({ condition: nested }) },
      { text: 'Stopped.' },
    );
    expect(stream).toContain('The first part reads the alert');
    expect(conditions()).toEqual([]);
  });

  test('reads in its guide when each kind fits', () => {
    for (const kind of ['"threshold"', '"change"', '"all" | "any"', '"no_data"'])
      expect(alertGuide).toContain(`"kind": ${kind}`);
    expect(alertGuide).toContain('dropped by half in 10 minutes');
    expect(alertGuide).toContain('never holds when that point is 0');
    expect(alertGuide).toContain('{change}');
    expect(alertGuide).toContain('{values}');
  });
});
