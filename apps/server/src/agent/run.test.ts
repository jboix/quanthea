import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  connectorInputSchema,
  defaultModelGateway,
  defaultModelSettings,
  type ModelGateway,
  type ModelSettings,
  type Plan,
} from '@quanthea/shared';
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
  await services.modelSettings.save(defaultModelGateway, { anthropic: 'sk-test' }, 'admin-1');
  ({ id: threadId } = services.threads.create('editor-1'));
});

afterEach(async () => {
  await services.close();
  dataDir.remove();
});

/**
 * The default gateway with some models or limits changed.
 *
 * @param changes - The models and limits to change.
 * @param changes.models - Models by job.
 * @param changes.limits - Limits.
 * @returns The gateway.
 */
function gatewayWith(changes: {
  models?: Partial<ModelSettings['models']>;
  limits?: Partial<ModelSettings['limits']>;
}): ModelGateway {
  const [first] = defaultModelGateway.providers;
  if (!first) throw new Error('The default gateway has a provider.');
  return {
    ...defaultModelGateway,
    providers: [{ ...first, models: { ...first.models, ...changes.models } }],
    limits: { ...defaultModelGateway.limits, ...changes.limits },
  };
}

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
 * A custom panel over the in-memory events.
 *
 * @param title - Its title.
 * @param show - Its view kind.
 * @param sql - Its query.
 * @returns The panel request.
 */
function eventsPanel(title: string, show: 'stat' | 'line', sql = 'SELECT * FROM events') {
  return {
    title,
    data: { kind: 'raw', connector: 'events', language: 'sql', query: sql },
    chart: { recipe: show === 'stat' ? 'kpi.stat' : 'trend.line' },
  };
}

/** The edit that builds the plan: a peak stat and a chart. */
const buildEdit = {
  title: 'Events',
  panels: [eventsPanel('Errors · peak', 'stat'), eventsPanel('Errors over time', 'line')],
  summary: 'built from plan',
};

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
  const build = agentWith({ tool: 'edit_dashboard', input: buildEdit }, { text: 'Built.' });
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

  test('plans with the catalog in hand, the planning tools only, and no panel guide', async () => {
    const model = scriptedStreamModel({ tool: 'propose_plan', input: plan });
    const agent = createAgent({ ...services, buildModel: () => model });
    await chat(agent, userMessage('u1', 'What happened to events?'));
    const [call] = model.doStreamCalls;
    const tools = (call?.tools ?? []).map((each) => each.name).sort();
    expect(tools).toEqual(['ask_person', 'describe', 'propose_plan', 'sample_values']);
    const system = JSON.stringify(call?.prompt[0]);
    expect(system).toContain('service text [checkout-svc, payments-svc, cart-svc]');
    expect(system).not.toContain('Building with edit_dashboard');
    expect(call?.reasoning).toBe('none');
  });

  test('rereads an earlier turn’s tool calls as short notes', async () => {
    const question = { question: 'Which errors?', options: ['HTTP 5xx', 'Failed orders'] };
    await chat(agentWith({ tool: 'ask_person', input: question }), userMessage('u1', 'Errors'));
    const model = scriptedStreamModel({ tool: 'propose_plan', input: plan });
    const agent = createAgent({ ...services, buildModel: () => model });
    await chat(agent, userMessage('u2', 'HTTP 5xx'));
    const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt);
    expect(prompt).toContain(
      '[earlier tool call] ask_person: \\"Which errors?\\" options [\\"HTTP 5xx\\",\\"Failed orders\\"]',
    );
    expect(prompt).not.toContain('"tool-call"');
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
      'tool-edit_dashboard',
      'data-version',
      'text',
    ]);
  });

  test('rereads an approved plan as approved when it builds', async () => {
    await chat(agentWith({ tool: 'propose_plan', input: plan }), userMessage('u1', 'Events?'));
    const [proposed] = services.threads.get(threadId).plans;
    services.threads.decidePlan(threadId, proposed?.id ?? '', 'approve', 'editor-1');
    const assistant = services.threads.get(threadId).messages[1] as { id: string };
    const model = scriptedStreamModel({ text: 'Building.' });
    const agent = createAgent({ ...services, buildModel: () => model });
    await chat(agent, { id: assistant.id, role: 'assistant', parts: [] });
    const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt);
    expect(prompt).toContain('The person approved this plan. Build it now.');
    expect(prompt).not.toContain('Waiting for the person to approve');
  });

  test('stores what the answer cost by model: the plan on the plan model, the build on the build model', async () => {
    await builtThread();
    const answer = services.threads.get(threadId).messages[1] as { metadata?: unknown };
    expect(answer.metadata).toEqual({
      usage: {
        'claude-haiku-4-5': { input: 10, cachedInput: 0, cacheWrite: 0, output: 5 },
        'claude-sonnet-5': { input: 20, cachedInput: 0, cacheWrite: 0, output: 10 },
      },
    });
  });

  test('records every step in the usage ledger, which outlives the thread', async () => {
    await builtThread();
    services.threads.remove(threadId, 'editor-1');
    const steps = services.usage.report(1).buckets.filter((bucket) => bucket.kind === 'model');
    expect(steps.map((bucket) => [bucket.model, bucket.events])).toEqual([
      ['claude-haiku-4-5', 1],
      ['claude-sonnet-5', 2],
    ]);
  });

  test('runs a thread on the provider it was started with', async () => {
    const mistral = {
      id: 'mistral-free',
      name: 'Mistral free',
      provider: 'mistral' as const,
      baseUrl: null,
      models: { plan: '', build: 'mistral-large-latest', repair: '', metadata: '' },
    };
    const gateway = {
      ...defaultModelGateway,
      providers: [...defaultModelGateway.providers, mistral],
    };
    await services.modelSettings.save(gateway, { 'mistral-free': 'mk-test' }, 'admin-1');
    ({ id: threadId } = services.threads.create('editor-1', 'mistral-free'));
    const used: string[] = [];
    const model = scriptedStreamModel({ text: 'Hello.' });
    const agent = createAgent({
      ...services,
      buildModel: (resolved) => {
        used.push(`${resolved.providerName}: ${resolved.settings.models.build}`);
        return model;
      },
    });
    await chat(agent, userMessage('u1', 'Hello'));
    expect(used[0]).toBe('Mistral free: mistral-large-latest');
    const steps = services.usage.report(1).buckets.filter((bucket) => bucket.kind === 'model');
    expect(steps.map((bucket) => bucket.provider)).toEqual(['Mistral free']);
  });

  test('hands the steps after a failed write to the repair model', async () => {
    const gateway = gatewayWith({ models: { repair: 'claude-opus-5-5' } });
    await services.modelSettings.save(gateway, {}, 'admin-1');
    services.threads.proposePlan(threadId, plan, true);
    const broken = {
      title: 'Events',
      panels: [eventsPanel('Errors', 'stat', 'SELECT * FROM missing')],
      summary: 'x',
    };
    const build = scriptedStreamModel({ tool: 'edit_dashboard', input: broken });
    const repair = scriptedStreamModel({ text: 'The table does not exist.' });
    const agent = createAgent({
      ...services,
      buildModel: (_resolved, job) => (job === 'repair' ? repair : build),
    });
    const stream = await chat(agent, userMessage('u1', 'Build it'));
    expect(stream).toContain('The table does not exist.');
    expect([build.doStreamCalls.length, repair.doStreamCalls.length]).toEqual([1, 1]);
    // The build log learns which try failed and why, by panel title.
    expect(stream).toContain('"type":"data-repair"');
    expect(stream).toContain('"attempt":1,"of":3,"outcome":"failed"');
    expect(stream).toContain('"title":"Errors"');
  });

  test('patches a mentioned panel of a ready thread without a plan, and streams the diff', async () => {
    await builtThread();
    const patch = {
      panels: [{ ...eventsPanel('Errors, worst minute', 'stat'), replaces: 'errors-peak' }],
      summary: 'renamed the peak',
    };
    const agent = agentWith({ tool: 'edit_dashboard', input: patch }, { text: 'Renamed.' });
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

  test('refuses a plan that names panels the draft does not have', async () => {
    await builtThread();
    const [first] = plan.panels;
    const changing = {
      ...plan,
      panels: [{ ...first, replaces: 'nope', change: 'by region' }],
      removes: ['gone'],
    };
    const stream = await chat(
      agentWith({ tool: 'propose_plan', input: changing }, { text: 'I will use the right ids.' }),
      userMessage('u2', 'Split it by region'),
    );
    expect(stream).toContain('The draft has no panel nope, gone.');
    expect(services.threads.get(threadId).plans).toHaveLength(1);
  });

  test('stores a failed tool input as input, so later turns raise no deprecation warning', async () => {
    const settings: string[] = [];
    const global = globalThis as { AI_SDK_LOG_WARNINGS?: unknown };
    const previous = global.AI_SDK_LOG_WARNINGS;
    global.AI_SDK_LOG_WARNINGS = ({ warnings }: { warnings: { setting?: string }[] }) =>
      settings.push(...warnings.map((warning) => warning.setting ?? ''));
    try {
      // ask_person without its options: the input fails the tool's schema.
      const invalid = { tool: 'ask_person', input: { question: 'Which errors?' } };
      await chat(
        agentWith(invalid, { text: 'Which errors do you mean?' }),
        userMessage('u1', 'Errors'),
      );
      const answer = services.threads.get(threadId).messages[1] as { parts: object[] };
      const failed = answer.parts.find((part) => 'state' in part && part.state === 'output-error');
      expect(failed).toMatchObject({ input: { question: 'Which errors?' } });
      expect(failed).not.toHaveProperty('rawInput');
      settings.length = 0;
      await chat(agentWith({ text: 'The 5xx ones, then.' }), userMessage('u2', 'The 5xx ones'));
      expect(settings).not.toContain('rawInput in output-error UI message parts');
    } finally {
      global.AI_SDK_LOG_WARNINGS = previous;
    }
  });

  test('hands back a new query that names a fixed time, to filter on the time range', async () => {
    services.threads.proposePlan(threadId, plan, true);
    const fixed = {
      title: 'Events',
      panels: [
        eventsPanel('Errors', 'stat', "SELECT * FROM events WHERE at >= '2026-10-01 13:00:00'"),
      ],
      summary: 'x',
    };
    const stream = await chat(
      agentWith({ tool: 'edit_dashboard', input: fixed }, { text: 'I will use the range.' }),
      userMessage('u1', 'Build it'),
    );
    expect(stream).toContain('compares with a fixed date: filter with :__from and :__to instead');
    expect(stream).toContain('"outcome":"failed"');
    expect(services.threads.get(threadId).dashboardId).toBeNull();
  });

  test('does not offer edit_dashboard before a plan is approved', async () => {
    const agent = agentWith(
      { tool: 'edit_dashboard', input: buildEdit },
      { text: 'I need a plan.' },
    );
    const stream = await chat(agent, userMessage('u1', 'Build it'));
    expect(stream).toContain("unavailable tool 'edit_dashboard'");
    expect(services.threads.get(threadId).dashboardId).toBeNull();
  });

  test('lets the model explain, with no tool, once the repair attempts are spent', async () => {
    await services.modelSettings.save(
      gatewayWith({ limits: { repairAttempts: 1 } }),
      {},
      'admin-1',
    );
    services.threads.proposePlan(threadId, plan, true);
    const broken = {
      title: 'Events',
      panels: [eventsPanel('Errors', 'stat', 'SELECT * FROM missing')],
      summary: 'x',
    };
    const model = scriptedStreamModel(
      { tool: 'edit_dashboard', input: broken },
      { text: 'The events table has no table named missing.' },
      { tool: 'edit_dashboard', input: broken, id: 'never' },
    );
    const agent = createAgent({ ...services, buildModel: () => model });
    const stream = await chat(agent, userMessage('u1', 'Build it'));
    expect(stream).toContain('No attempts left');
    expect(stream).toContain('"outcome":"exhausted"');
    expect(stream).toContain('The events table has no table named missing.');
    // The explaining step is offered no tool, and the turn ends after it.
    expect(model.doStreamCalls).toHaveLength(2);
    expect(model.doStreamCalls[1]?.toolChoice).toEqual({ type: 'none' });
    expect(services.threads.get(threadId).state).toBe('building');
  });

  test('saves the new panels that work, and reports the ones left out', async () => {
    services.threads.proposePlan(threadId, plan, true);
    const mixed = {
      title: 'Events',
      panels: [
        eventsPanel('Errors', 'stat'),
        eventsPanel('Broken', 'line', 'SELECT * FROM missing'),
      ],
      summary: 'first build',
    };
    const fixed = { panels: [eventsPanel('Broken', 'line')], summary: 'the other one' };
    const stream = await chat(
      agentWith(
        { tool: 'edit_dashboard', input: mixed },
        { tool: 'edit_dashboard', input: fixed },
        { text: 'Both are in.' },
      ),
      userMessage('u1', 'Build it'),
    );
    expect(stream).toContain(
      'These new panels were left out because they do not work, so the draft does not have them.',
    );
    expect(stream).toContain('"outcome":"left-out"');
    expect(stream).toContain('"outcome":"repaired"');
    const { dashboardId } = services.threads.get(threadId);
    const first = services.dashboards.getVersion(dashboardId ?? '', 1, 'editor').spec;
    expect(first.panels.map((panel) => panel.id)).toEqual(['errors']);
    // The panel left out comes back in the same run, with no new plan.
    const second = services.dashboards.getVersion(dashboardId ?? '', 2, 'editor').spec;
    expect(second.panels.map((panel) => panel.id)).toEqual(['errors', 'broken']);
  });

  test('offers matching pinned dashboards on the first question, with no model', async () => {
    const pinned = services.dashboards.create(eventsSpec(), 'first', 'editor-1');
    await services.dashboards.pin(pinned.id, 1, 'editor-1');
    const model = scriptedStreamModel({ text: 'This step never runs.' });
    const agent = createAgent({ ...services, buildModel: () => model });
    const stream = await chat(agent, userMessage('u1', 'Show me the events errors'));
    expect(stream).toContain('"type":"data-matches"');
    expect(stream).toContain('A pinned dashboard may already answer this.');
    expect(model.doStreamCalls).toHaveLength(0);
    expect(storedPartTypes()).toEqual([['text'], ['text', 'data-matches']]);
  });

  test('builds a new one when the person asks, after the matches', async () => {
    const pinned = services.dashboards.create(eventsSpec(), 'first', 'editor-1');
    await services.dashboards.pin(pinned.id, 1, 'editor-1');
    await chat(agentWith({ text: 'unused' }), userMessage('u1', 'Show me the events errors'));
    const answer = services.threads.get(threadId).messages[1] as { id: string };
    const model = scriptedStreamModel({ text: 'Which errors do you mean?' });
    const agent = createAgent({ ...services, buildModel: () => model });
    await chat(agent, { id: answer.id, role: 'assistant', parts: [] });
    const prompt = model.doStreamCalls[0]?.prompt ?? [];
    expect(JSON.stringify(prompt)).toContain('asked for a new one');
    // Providers such as Gemini refuse a request that ends on the model's own turn.
    expect(prompt.at(-1)).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'Continue.' }],
    });
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
      resolve: async () => ({
        settings: defaultModelSettings,
        apiKey: null,
        providerId: 'anthropic',
        providerName: 'Anthropic',
      }),
    };
    const agent = createAgent({ ...services, modelSettings });
    expect((await failureOf(chat(agent, userMessage('u1', 'Hello')))).message).toBe(
      'Save an API key in Settings → Model first.',
    );
  });
});
