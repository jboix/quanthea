import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  channelInputSchema,
  connectorInputSchema,
  defaultModelGateway,
  type ThreadData,
} from '@quanthea/shared';
import { eventsSpec } from '../dashboards/test/events-spec.ts';
import { temporaryDir, testServices } from '../test/fixtures.ts';
import { type Agent, createAgent } from './run.ts';
import { type ScriptedStep, scriptedStreamModel } from './test/mock-model.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;
let threadId = '';
let channelId = '';

beforeEach(async () => {
  dataDir = temporaryDir();
  services = await testServices(dataDir.path);
  await services.modelSettings.save(defaultModelGateway, { anthropic: 'sk-test' }, 'admin-1');
  const channel = { name: 'Sales', kind: 'webhook', target: 'http://127.0.0.1:9/hook' };
  channelId = (await services.notifications.create(channelInputSchema.parse(channel), 'admin-1'))
    .id;
  const input = {
    name: 'events',
    kind: 'memory',
    config: {},
    secret: { token: 't' },
    accessLevel: 2,
  };
  await services.connections.create(connectorInputSchema.parse(input), 'admin-1');
  ({ id: threadId } = services.threads.create('editor-1', null, undefined, { kind: 'report' }));
});

afterEach(async () => {
  await services.close();
  dataDir.remove();
});

/**
 * A report plan, as the model proposes it.
 *
 * @param overrides - Fields to replace.
 * @returns The plan.
 */
function plan(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Weekly errors',
    runs: 'Mondays at 08:00, Europe/Zurich',
    covers: 'the previous week',
    compares: 'the week before',
    shows: 'the peak of errors, and errors over time',
    connectors: ['events'],
    seeAlso: [],
    channels: [channelId],
    ...overrides,
  };
}

/**
 * A panel over the in-memory events, as edit_dashboard and edit_report take it.
 *
 * @param title - Its title.
 * @param show - A stat or a line chart.
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

/**
 * The whole report, as the model writes it the first time.
 *
 * @param overrides - Fields to replace.
 * @returns The edit.
 */
function reportEdit(overrides: Record<string, unknown> = {}) {
  return {
    summary: 'first draft',
    title: 'Weekly errors',
    schedule: { every: 'week', weekday: 'monday', at: '08:00', timezone: 'Europe/Zurich' },
    period: 'previous_week',
    panels: [eventsPanel('Errors · peak', 'stat'), eventsPanel('Errors over time', 'line')],
    summaryPanels: ['Errors · peak'],
    channels: [channelId],
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
    signal: AbortSignal.timeout(10_000),
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
 * @param proposed - The plan to propose.
 * @returns The assistant message to continue.
 */
async function approvedThread(proposed = plan()): Promise<{ id: string; role: string; parts: [] }> {
  await chat(agentWith({ tool: 'propose_report', input: proposed }).agent, userMessage('u1', 'Hi'));
  const [stored] = services.threads.get(threadId).plans;
  services.threads.decidePlan(threadId, stored?.id ?? '', 'approve', 'editor-1');
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

/**
 * The versions of the thread's report, the latest first.
 *
 * @returns The versions.
 */
function versions() {
  const { reportId } = services.threads.get(threadId);
  return services.reports.get(reportId ?? '', 'editor').versions;
}

/**
 * A pinned dashboard over the events.
 *
 * @returns Its id.
 */
async function pinnedDashboard(): Promise<string> {
  const dashboard = services.dashboards.create(eventsSpec(), 'first', 'editor-1');
  await services.dashboards.pin(dashboard.id, 1, 'editor-1');
  return dashboard.id;
}

describe('a report thread', () => {
  test('plans with the report tools and instructions, never the dashboard or alert ones', async () => {
    const pinned = await pinnedDashboard();
    const { agent, model } = agentWith({ tool: 'propose_report', input: plan() });
    const stream = await chat(agent, userMessage('u1', 'Every Monday, last week’s errors'));
    expect(toolsOf(model)).toEqual(['ask_person', 'describe', 'propose_report', 'sample_values']);
    const system = JSON.stringify(model.doStreamCalls[0]?.prompt);
    expect(system).toContain('report analyst');
    expect(system).toContain(`${channelId} (\\"Sales\\", webhook)`);
    expect(system).toContain(`${pinned} (\\"Events\\")`);
    expect(system).not.toContain('dashboard analyst');
    expect(system).not.toContain('alert analyst');
    expect(stream).toContain('"type":"data-reportPlan"');
    expect(stored('data-reportPlan')[0]?.body.channels).toEqual([{ id: channelId, name: 'Sales' }]);
    expect(services.threads.get(threadId).state).toBe('plan_pending');
  });

  test('proposes only channels and pinned dashboards from the lists', async () => {
    const { agent } = agentWith(
      { tool: 'propose_report', input: plan({ channels: ['made-up'], seeAlso: ['nope'] }) },
      { text: 'Sorry.' },
    );
    const stream = await chat(agent, userMessage('u1', 'Errors weekly'));
    expect(stream).toContain('No channel \\"made-up\\"');
    expect(stream).toContain('No pinned dashboard \\"nope\\"');
    expect(services.threads.get(threadId).plans).toEqual([]);
  });

  test('writes the approved report as a draft version, previewed on its latest period', async () => {
    const assistant = await approvedThread();
    const { agent, model } = agentWith(
      { tool: 'edit_report', input: reportEdit() },
      { text: 'Written.' },
    );
    const stream = await chat(agent, assistant);
    expect(toolsOf(model)).toEqual([
      'chart_recipe',
      'describe',
      'edit_report',
      'read_guide',
      'sample_values',
      'test_query',
    ]);
    const thread = services.threads.get(threadId);
    expect(thread).toMatchObject({ state: 'ready', kind: 'report', reportActive: false });
    const report = services.reports.get(thread.reportId ?? '', 'editor');
    expect(report).toMatchObject({ threadId, activeVersion: null });
    const [first] = versions();
    expect(first?.note).toBe('first draft');
    expect(first?.spec.summaryPanels).toEqual(['errors-peak']);
    expect(first?.spec.delivery.channels).toEqual([channelId]);
    expect(first?.spec.panels.map((panel) => panel.view.kind)).toEqual(['stat', 'chart']);
    expect(stored('data-reportVersion')).toEqual([
      { reportId: thread.reportId ?? '', version: 1, note: 'first draft' },
    ]);
    expect(stream).toContain('"period":"week ');
    // Level 2 shows the columns and row counts, never values.
    expect(stream).not.toContain('checkout-svc');
  });

  test('sends back the issues of a report that does not validate, then repairs it', async () => {
    const assistant = await approvedThread();
    const broken = reportEdit({ summaryPanels: ['Errors over time'] });
    const { agent } = agentWith(
      { tool: 'edit_report', input: broken },
      { tool: 'edit_report', input: reportEdit() },
      { text: 'Fixed.' },
    );
    const stream = await chat(agent, assistant);
    expect(stream).toContain('summaryPanels[0]');
    expect(stored('data-repair').map((repair) => repair.outcome)).toEqual(['failed', 'repaired']);
    expect(versions()).toHaveLength(1);
  });

  test('counts a panel whose query fails, names it, and stops at the limit', async () => {
    const assistant = await approvedThread();
    const failing = reportEdit({
      panels: [eventsPanel('Errors · peak', 'stat', 'SELECT nope FROM events')],
    });
    const { agent } = agentWith(
      { tool: 'edit_report', input: failing },
      { tool: 'edit_report', input: failing },
      { tool: 'edit_report', input: failing },
      { text: 'It does not work.' },
    );
    await chat(agent, assistant);
    const repairs = stored('data-repair');
    expect(repairs.map((repair) => repair.outcome)).toEqual(['failed', 'failed', 'exhausted']);
    expect(repairs[0]?.panels.map((panel) => panel.title)).toEqual(['Errors · peak']);
    expect(services.threads.get(threadId).reportId).toBeNull();
  });

  test('refuses a channel or a dashboard that is not in the lists', async () => {
    const assistant = await approvedThread();
    const { agent } = agentWith(
      {
        tool: 'edit_report',
        input: reportEdit({ channels: ['made-up'], seeAlso: [{ dashboardId: 'nope' }] }),
      },
      { text: 'Stopped.' },
    );
    const stream = await chat(agent, assistant);
    expect(stream).toContain('channels[0]');
    expect(stream).toContain('seeAlso[0].dashboardId');
    expect(services.threads.get(threadId).reportId).toBeNull();
  });

  test('links a pinned dashboard from the list, and merges a later edit over the draft', async () => {
    const pinned = await pinnedDashboard();
    const assistant = await approvedThread(plan({ seeAlso: [pinned] }));
    const first = reportEdit({ seeAlso: [{ dashboardId: pinned, label: 'All events' }] });
    await chat(
      agentWith({ tool: 'edit_report', input: first }, { text: 'Done.' }).agent,
      assistant,
    );
    const change = {
      summary: 'on Tuesdays',
      schedule: { every: 'week', weekday: 'tuesday', at: '09:00', timezone: 'Europe/Zurich' },
    };
    const editing = agentWith({ tool: 'edit_report', input: change }, { text: 'Moved.' });
    await chat(editing.agent, userMessage('u2', 'Tuesdays at 9 instead'));
    expect(toolsOf(editing.model)).toEqual([
      'ask_person',
      'chart_recipe',
      'describe',
      'edit_report',
      'propose_report',
      'read_guide',
      'sample_values',
      'test_query',
    ]);
    const [latest] = versions();
    expect(latest?.version).toBe(2);
    expect(latest?.spec.schedule).toMatchObject({ weekday: 'tuesday', at: '09:00' });
    expect(latest?.spec.seeAlso).toEqual([{ dashboardId: pinned, label: 'All events' }]);
    expect(latest?.spec.panels.map((panel) => panel.id)).toEqual([
      'errors-peak',
      'errors-over-time',
    ]);
    expect(latest?.spec.summaryPanels).toEqual(['errors-peak']);
  });

  test('reads the person’s hand edits in its next turn', async () => {
    const assistant = await approvedThread();
    await chat(
      agentWith({ tool: 'edit_report', input: reportEdit() }, { text: 'Done.' }).agent,
      assistant,
    );
    const changes = [{ path: 'schedule.weekday', before: 'monday', after: 'friday' }];
    const data = { reportId: 'r', from: 1, to: 2, changes };
    const card = { id: 'hand-1', role: 'user', parts: [{ type: 'data-reportHandEdit', data }] };
    const { messages } = services.threads.get(threadId);
    services.threads.saveMessages(threadId, [...(messages as never[]), card], 'editor-1');
    const { agent, model } = agentWith({ text: 'Noted.' });
    await chat(agent, userMessage('u2', 'Is Friday better?'));
    const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt);
    expect(prompt).toContain('I changed the report by hand, v1 → v2] schedule.weekday: monday');
  });

  test('counts its steps as building reports in the usage ledger', async () => {
    await chat(
      agentWith({ tool: 'propose_report', input: plan() }).agent,
      userMessage('u1', 'Errors?'),
    );
    const features = services.usage.report(1).buckets.map((bucket) => bucket.feature);
    expect(new Set(features)).toEqual(new Set(['report']));
  });
});
