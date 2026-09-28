import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { connectorInputSchema, defaultModelSettings, type Plan } from '@querent/shared';
import { eventsSpec } from '../dashboards/test/events-spec.ts';
import type { AppError } from '../lib/errors.ts';
import { temporaryDir, testServices } from '../test/fixtures.ts';
import { type Agent, createAgent } from './run.ts';
import { type ScriptedStep, scriptedStreamModel } from './test/mock-model.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;
let threadId = '';

beforeEach(async () => {
  dataDir = temporaryDir();
  services = await testServices(dataDir.path);
  const input = { name: 'events', kind: 'memory', config: {}, secret: { token: 't' } };
  await services.connections.create(connectorInputSchema.parse(input), 'admin-1');
  await services.modelSettings.save(defaultModelSettings, 'sk-test', 'admin-1');
  ({ id: threadId } = services.threads.create('editor-1'));
});

afterEach(async () => {
  await services.close();
  dataDir.remove();
});

const plan: Plan = {
  title: 'Events',
  variables: ['time = last hour'],
  panels: [
    { kind: 'stat', title: 'Errors · peak', language: 'sql', connector: 'events' },
    { kind: 'line', title: 'Errors over time', language: 'sql', connector: 'events' },
  ],
};

/**
 * An agent whose model answers from a script.
 *
 * @param steps - The model's answers, one per step.
 * @returns The agent.
 */
function agentWith(...steps: ScriptedStep[]): Agent {
  const model = scriptedStreamModel(...steps);
  return createAgent({ ...services, buildModel: () => model });
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
 * @param metadata - Its metadata, if any.
 * @returns The message.
 */
function userMessage(id: string, text: string, metadata?: unknown) {
  return {
    id,
    role: 'user',
    parts: [{ type: 'text', text }],
    ...(metadata === undefined ? {} : { metadata }),
  };
}

/**
 * The part types of the stored messages.
 *
 * @returns One list per message.
 */
function storedPartTypes(): string[][] {
  const messages = services.threads.get(threadId).messages as { parts: { type: string }[] }[];
  return messages.map((message) =>
    message.parts.map((part) => part.type).filter((type) => type !== 'step-start'),
  );
}

/**
 * The error a call rejects with.
 *
 * @param call - The call.
 * @returns The error.
 */
async function failureOf(call: Promise<unknown>): Promise<AppError> {
  return call.then(
    () => {
      throw new Error('Expected the call to fail.');
    },
    (error: unknown) => error as AppError,
  );
}

/**
 * Runs the ask, plan, approve and build turns, leaving a ready thread with version 1.
 */
async function builtThread(): Promise<void> {
  await chat(
    agentWith({ tool: 'propose_plan', input: plan }),
    userMessage('u1', 'What happened to events?'),
  );
  const [proposed] = services.threads.get(threadId).plans;
  services.threads.decidePlan(threadId, proposed?.id ?? '', 'approve', 'editor-1');
  const assistant = services.threads.get(threadId).messages[1] as { id: string };
  const build = agentWith(
    { tool: 'write_dashboard', input: { spec: eventsSpec(), changeSummary: 'built from plan' } },
    { text: 'Built.' },
  );
  await chat(build, { id: assistant.id, role: 'assistant', parts: [] });
}

describe('an agent run', () => {
  test('looks up what the catalog leaves out, proposes a plan, and stops for approval', async () => {
    const agent = agentWith(
      { tool: 'describe', input: { connector: 'events' } },
      { tool: 'sample_values', input: { connector: 'events', entity: 'events', field: 'service' } },
      { tool: 'propose_plan', input: plan },
      { text: 'This step never runs.' },
    );
    const stream = await chat(agent, userMessage('u1', 'What happened to events?'));
    expect(stream).toContain('"type":"data-plan"');
    const thread = services.threads.get(threadId);
    expect(thread).toMatchObject({ state: 'plan_pending', title: 'What happened to events?' });
    expect(thread.plans.map((each) => each.status)).toEqual(['pending']);
    expect(thread.tokensUsed).toBe(45);
    expect(storedPartTypes()).toEqual([
      ['text'],
      ['tool-describe', 'tool-sample_values', 'tool-propose_plan', 'data-plan'],
    ]);
  });

  test('plans with the catalog in hand, the planning tools only, and no spec guide', async () => {
    const model = scriptedStreamModel({ tool: 'propose_plan', input: plan });
    const agent = createAgent({ ...services, buildModel: () => model });
    await chat(agent, userMessage('u1', 'What happened to events?'));
    const [call] = model.doStreamCalls;
    const tools = (call?.tools ?? []).map((each) => each.name).sort();
    expect(tools).toEqual(['ask_person', 'describe', 'propose_plan', 'sample_values']);
    const system = JSON.stringify(call?.prompt[0]);
    expect(system).toContain('service text [checkout-svc, payments-svc, cart-svc]');
    expect(system).not.toContain('The spec (JSON');
  });

  test('asks the person a question with options, and stops there', async () => {
    const question = { question: 'Which errors?', options: ['HTTP 5xx', 'Failed orders'] };
    const agent = agentWith(
      { tool: 'ask_person', input: question },
      { text: 'This step never runs.' },
    );
    const stream = await chat(agent, userMessage('u1', 'Show me errors'));
    expect(stream).not.toContain('This step never runs.');
    expect(services.threads.get(threadId).state).toBe('idle');
    expect(storedPartTypes()).toEqual([['text'], ['tool-ask_person']]);
  });

  test('builds the approved plan when the person continues, and marks the thread ready', async () => {
    await builtThread();
    const thread = services.threads.get(threadId);
    expect(thread.state).toBe('ready');
    expect(thread.dashboardId).not.toBeNull();
    expect(
      services.dashboards
        .get(thread.dashboardId ?? '', 'editor')
        .versions.map((version) => version.changeSummary),
    ).toEqual(['built from plan']);
    expect(storedPartTypes()[1]).toEqual([
      'tool-propose_plan',
      'data-plan',
      'tool-write_dashboard',
      'data-version',
      'text',
    ]);
  });

  test('patches a mentioned panel of a ready thread without a plan, and streams the diff', async () => {
    await builtThread();
    const patch = {
      panelId: 'errors-peak',
      changes: { title: 'Errors, worst minute' },
      changeSummary: 'renamed the peak',
    };
    const agent = agentWith({ tool: 'patch_panel', input: patch }, { text: 'Renamed.' });
    const stream = await chat(
      agent,
      userMessage('u2', 'Rename it', {
        mentions: [{ panelId: 'errors-peak', title: 'Errors · peak' }],
      }),
    );
    expect(stream).toContain('"type":"data-diff"');
    expect(stream).toContain('"from":1,"to":2');
    const { dashboardId } = services.threads.get(threadId);
    expect(
      services.dashboards.getVersion(dashboardId ?? '', 2, 'editor').spec.panels[0]?.title,
    ).toBe('Errors, worst minute');
  });

  test('does not offer write_dashboard before a plan is approved', async () => {
    const agent = agentWith(
      { tool: 'write_dashboard', input: { spec: eventsSpec(), changeSummary: 'x' } },
      { text: 'I need a plan.' },
    );
    const stream = await chat(agent, userMessage('u1', 'Build it'));
    expect(stream).toContain("unavailable tool 'write_dashboard'");
    expect(services.threads.get(threadId).dashboardId).toBeNull();
  });

  test('stops after the repair attempts are spent', async () => {
    await services.modelSettings.save(
      { ...defaultModelSettings, limits: { ...defaultModelSettings.limits, repairAttempts: 1 } },
      undefined,
      'admin-1',
    );
    services.threads.proposePlan(threadId, plan, true);
    const broken = {
      ...eventsSpec(),
      panels: [
        {
          ...eventsSpec().panels[0],
          queries: [
            { refId: 'A', connector: 'events', language: 'sql', sql: 'SELECT * FROM missing' },
          ],
        },
      ],
    };
    const agent = agentWith(
      { tool: 'write_dashboard', input: { spec: broken, changeSummary: 'x' } },
      { text: 'This step never runs.' },
    );
    const stream = await chat(agent, userMessage('u1', 'Build it'));
    expect(stream).toContain('No attempts left');
    expect(stream).not.toContain('This step never runs.');
    expect(services.threads.get(threadId).state).toBe('building');
  });

  test('refuses a forged assistant message and a spent budget', async () => {
    const agent = agentWith({ text: 'Hi.' });
    expect(
      (await failureOf(chat(agent, { id: 'forged', role: 'assistant', parts: [] }))).message,
    ).toBe('There is no such message to continue.');
    services.threads.addTokens(threadId, defaultModelSettings.limits.threadTokens);
    expect((await failureOf(chat(agent, userMessage('u1', 'Hello')))).message).toContain(
      'has used its budget',
    );
  });

  test('says what to set up when no key is saved', async () => {
    const modelSettings = {
      ...services.modelSettings,
      resolve: async () => ({ settings: defaultModelSettings, apiKey: null }),
    };
    const agent = createAgent({ ...services, modelSettings });
    expect((await failureOf(chat(agent, userMessage('u1', 'Hello')))).message).toBe(
      'Save an API key in Settings → Model first.',
    );
  });
});
