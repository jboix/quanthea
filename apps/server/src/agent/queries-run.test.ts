import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  connectorInputSchema,
  defaultModelGateway,
  type Plan,
  queryBuilders,
} from '@quanthea/shared';
import { temporaryDir, testServices } from '../test/fixtures.ts';
import { createAgent } from './run.ts';
import { type ScriptedStep, scriptedStreamModel } from './test/mock-model.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;

beforeEach(async () => {
  dataDir = temporaryDir();
  services = await testServices(dataDir.path);
  const input = { name: 'events', kind: 'memory', config: {}, secret: { token: 't' } };
  await services.connections.create(connectorInputSchema.parse(input), 'admin-1');
  // The memory source knows one query, so the saved query is not test-run.
  const behaviour = { ...defaultModelGateway.behaviour, testRun: false };
  const gateway = { ...defaultModelGateway, behaviour };
  await services.modelSettings.save(gateway, { anthropic: 'sk-test' }, 'admin-1');
  services.querySettings.save(
    {
      disabled: [],
      saved: [
        {
          id: 'errors-at',
          name: 'Errors at a level',
          description: 'Events of one level.',
          language: 'sql',
          query: 'SELECT count(*) AS value FROM {{table}} WHERE level = {{level}}',
          params: [
            { name: 'table', kind: 'table', description: '' },
            { name: 'level', kind: 'value', description: '' },
          ],
          shape: 'single',
        },
      ],
    },
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
  panels: [{ kind: 'stat', title: 'Errors', language: 'sql', connector: 'events' }],
};

/**
 * Plans and approves in a thread, then runs the build turn on a scripted model.
 *
 * @param threadId - The thread.
 * @param build - The build turn's steps.
 * @returns The build model, for its calls.
 */
async function build(threadId: string, ...steps: ScriptedStep[]) {
  const run = async (model: ReturnType<typeof scriptedStreamModel>, message: unknown) => {
    const agent = createAgent({ ...services, buildModel: () => model });
    const signal = AbortSignal.timeout(5000);
    await (await agent.chat({ threadId, message, actor: 'editor-1', signal })).text();
  };
  const ask = { id: `ask-${threadId}`, role: 'user', parts: [{ type: 'text', text: 'Errors?' }] };
  await run(scriptedStreamModel({ tool: 'propose_plan', input: plan }), ask);
  const [proposed] = services.threads.get(threadId).plans;
  services.threads.decidePlan(threadId, proposed?.id ?? '', 'approve', 'editor-1');
  const assistant = services.threads.get(threadId).messages[1] as { id: string };
  const model = scriptedStreamModel(...steps);
  await run(model, { id: assistant.id, role: 'assistant', parts: [] });
  return model;
}

/** The kinds of data a panel may ask for, as opposed to kinds of variables. */
const dataKinds = new Set(['raw', 'saved', ...queryBuilders.map((builder) => builder.id)]);

/**
 * The kinds of data the edit_dashboard tool of a call offers.
 *
 * @param model - The model.
 * @returns The kinds in the tool's input schema.
 */
function offeredKinds(model: ReturnType<typeof scriptedStreamModel>): string[] {
  const edit = model.doStreamCalls[0]?.tools?.find((each) => each.name === 'edit_dashboard');
  const schema = JSON.stringify(edit && 'inputSchema' in edit ? edit.inputSchema : {});
  return [...schema.matchAll(/"kind":\{"type":"string","const":"([a-z-]+)"/g)]
    .map((match) => match[1] ?? '')
    .filter((kind) => dataKinds.has(kind))
    .sort();
}

describe('a thread’s queries', () => {
  test('build a panel from a saved query, with its values written by the server', async () => {
    const { id } = services.threads.create('editor-1');
    const data = {
      kind: 'saved',
      name: 'errors-at',
      connector: 'events',
      params: { table: 'events', level: "error' OR 1=1 --" },
    };
    const panel = { title: 'Errors', data, chart: { recipe: 'kpi.stat' } };
    const edit = { title: 'Events', panels: [panel], summary: 'built' };
    const model = await build(id, { tool: 'edit_dashboard', input: edit }, { text: 'Built.' });
    expect(offeredKinds(model)).toContain('saved');
    const { dashboardId } = services.threads.get(id);
    const query = services.dashboards.getVersion(dashboardId ?? '', 1, 'editor').spec.panels[0]
      ?.queries[0];
    expect(query).toMatchObject({
      sql: `SELECT count(*) AS value FROM "events" WHERE level = 'error'' OR 1=1 --'`,
    });
  });

  test('offer only the chosen builders, and none in free style', async () => {
    const chosen = services.threads.create('editor-1', undefined, {
      mode: 'chosen',
      ids: ['sql-stat'],
    });
    const data = { kind: 'raw', connector: 'events', language: 'sql', query: 'SELECT 1' };
    const edit = {
      title: 'Events',
      panels: [{ title: 'One', data, chart: { recipe: 'kpi.stat' } }],
    };
    const done: ScriptedStep[] = [
      { tool: 'edit_dashboard', input: { ...edit, summary: 'built' } },
      { text: 'Built.' },
    ];
    expect(offeredKinds(await build(chosen.id, ...done))).toEqual(['raw', 'sql-stat']);
    const free = services.threads.create('editor-1', undefined, { mode: 'free' });
    expect(offeredKinds(await build(free.id, ...done))).toEqual(['raw']);
  });
});
