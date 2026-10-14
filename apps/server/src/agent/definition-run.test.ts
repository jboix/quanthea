import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { connectorInputSchema, defaultModelGateway, type Plan } from '@quanthea/shared';
import { temporaryDir, testServices } from '../test/fixtures.ts';
import { createAgent } from './run.ts';
import { type ScriptedStep, scriptedStreamModel } from './test/mock-model.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;
let threadId = '';

const plan: Plan = {
  title: 'Events',
  variables: [],
  panels: [
    {
      kind: 'stat',
      title: 'Failures',
      language: 'sql',
      connector: 'events',
      definition: 'failures',
    },
  ],
};

beforeEach(async () => {
  dataDir = temporaryDir();
  services = await testServices(dataDir.path);
  const input = { name: 'events', kind: 'memory', config: {}, secret: { token: 't' } };
  await services.connections.create(connectorInputSchema.parse(input), 'admin-1');
  // The memory source knows one query, so the built query is not test-run.
  const behaviour = { ...defaultModelGateway.behaviour, testRun: false };
  const gateway = { ...defaultModelGateway, behaviour };
  await services.modelSettings.save(gateway, { anthropic: 'sk-test' }, 'admin-1');
  const failures = {
    id: 'failures',
    name: 'Failures',
    meaning: 'Events at the error level, without the planned outages.',
    bodies: [
      {
        shape: 'measure',
        request: {
          kind: 'sql-stat',
          table: 'events',
          filters: [{ field: 'level', value: 'error' }],
          measure: { fn: 'count' },
        },
      },
    ],
  };
  await services.definitions.save(failures, null, 'editor-1', 'file');
  ({ id: threadId } = services.threads.create('editor-1'));
  services.threads.proposePlan(threadId, plan, true);
});

afterEach(async () => {
  await services.close();
  dataDir.remove();
});

/**
 * Runs one turn with a scripted model.
 *
 * @param steps - The model's answers, one per step.
 * @returns The model, for the prompts it received.
 */
async function turn(...steps: ScriptedStep[]) {
  const model = scriptedStreamModel(...steps);
  const agent = createAgent({ ...services, buildModel: () => model });
  const message = { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: 'Go' }] };
  const signal = AbortSignal.timeout(5000);
  await (await agent.chat({ threadId, message, actor: 'editor-1', signal })).text();
  return model;
}

/**
 * The panels of the thread's latest version.
 *
 * @returns The panels.
 */
function latestPanels() {
  const { dashboardId } = services.threads.get(threadId);
  const detail = services.dashboards.get(dashboardId ?? '', 'editor');
  const latest = detail.versions.at(-1)?.version ?? 0;
  const spec = services.dashboards.getVersion(dashboardId ?? '', latest, 'editor').spec as {
    panels: { title: string; definition?: unknown; queries: { sql?: string }[] }[];
  };
  return spec.panels;
}

describe('a run with definitions', () => {
  test('tells the model what the team means, and copies the definition into the panel', async () => {
    const data = { kind: 'definition', id: 'failures', builder: 'sql-stat', connector: 'events' };
    const panel = { title: 'Failures', data, chart: { recipe: 'kpi.stat' } };
    const model = await turn(
      { tool: 'edit_dashboard', input: { title: 'Events', panels: [panel], summary: 'built' } },
      { text: 'Built.' },
    );
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain(
      '- failures \\"Failures\\": Events at the error level, without the planned outages. [checked: sql (measure)]',
    );
    const [built] = latestPanels();
    expect(built?.definition).toEqual({ id: 'failures', version: 1 });
    expect(built?.queries[0]?.sql).toContain('level');
  });

  test('notes a panel that names a defined term without its definition, and keeps it', async () => {
    const data = {
      kind: 'raw',
      connector: 'events',
      language: 'sql',
      query: 'SELECT * FROM events',
    };
    const panel = { title: 'Failures', data, chart: { recipe: 'kpi.stat' } };
    const model = await turn(
      { tool: 'edit_dashboard', input: { title: 'Events', panels: [panel], summary: 'built' } },
      { text: 'Built.' },
    );
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain(
      'names Failures but does not use the definition failures',
    );
    expect(latestPanels()).toHaveLength(1);
  });
});
