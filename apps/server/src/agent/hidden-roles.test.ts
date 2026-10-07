/**
 * A chart's roles are completed from the data the model may see: a hidden column never becomes a
 * role, so its name never reaches the saved draft or the prompt of the next turn.
 */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { connectorInputSchema, defaultModelGateway, type Plan } from '@quanthea/shared';
import { temporaryDir, testServices } from '../test/fixtures.ts';
import { createAgent } from './run.ts';
import { type ScriptedStep, scriptedStreamModel } from './test/mock-model.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;

beforeEach(async () => {
  dataDir = temporaryDir();
  services = await testServices(dataDir.path);
  const input = {
    name: 'events',
    kind: 'memory',
    config: {},
    secret: { token: 't' },
    accessLevel: 4,
    hiddenFields: ['events.service'],
  };
  await services.connections.create(connectorInputSchema.parse(input), 'admin-1');
  const behaviour = { ...defaultModelGateway.behaviour, testRun: false };
  await services.modelSettings.save(
    { ...defaultModelGateway, behaviour },
    { anthropic: 'sk-test' },
    'admin-1',
  );
});

afterEach(async () => {
  await services.close();
  dataDir.remove();
});

const plan: Plan = {
  title: 'Events',
  variables: [],
  panels: [{ kind: 'table', title: 'Events', language: 'sql', connector: 'events' }],
};

/**
 * Runs one turn of a thread on a scripted model.
 *
 * @param threadId - The thread.
 * @param message - The message the turn answers.
 * @param steps - The model's steps.
 * @returns The model, for its calls.
 */
async function turn(threadId: string, message: unknown, ...steps: ScriptedStep[]) {
  const model = scriptedStreamModel(...steps);
  const agent = createAgent({ ...services, buildModel: () => model });
  const signal = AbortSignal.timeout(5000);
  await (await agent.chat({ threadId, message, actor: 'editor-1', signal })).text();
  return model;
}

test('a table over every column never names a hidden one in its draft or the next prompt', async () => {
  const { id } = services.threads.create('editor-1');
  const ask = { id: 'ask-1', role: 'user', parts: [{ type: 'text', text: 'Events?' }] };
  await turn(id, ask, { tool: 'propose_plan', input: plan });
  const [proposed] = services.threads.get(id).plans;
  services.threads.decidePlan(id, proposed?.id ?? '', 'approve', 'editor-1');
  const assistant = services.threads.get(id).messages[1] as { id: string };
  const data = { kind: 'raw', connector: 'events', language: 'sql', query: 'SELECT * FROM events' };
  const panel = { title: 'Events', data, chart: { recipe: 'table.rows' } };
  const edit = { title: 'Events', panels: [panel], summary: 'built' };
  const build = { id: assistant.id, role: 'assistant', parts: [] };
  await turn(id, build, { tool: 'edit_dashboard', input: edit }, { text: 'Built.' });
  const { dashboardId } = services.threads.get(id);
  const spec = services.dashboards.getVersion(dashboardId ?? '', 1, 'editor').spec;
  expect(spec.panels[0]?.view).toMatchObject({
    kind: 'table',
    columns: [{ field: 'time' }, { field: 'errors' }],
  });
  expect(JSON.stringify(spec)).not.toContain('service');
  const followUp = { id: 'ask-2', role: 'user', parts: [{ type: 'text', text: 'Thanks.' }] };
  const next = await turn(id, followUp, { text: 'Done.' });
  const prompt = JSON.stringify(next.doStreamCalls[0]?.prompt);
  const draft = prompt.slice(prompt.indexOf('Current draft'), prompt.indexOf('A plan for'));
  expect(draft).toContain('errors');
  expect(draft).not.toContain('service');
});
