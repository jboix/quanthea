import { afterEach, beforeEach, expect, test } from 'bun:test';
import { connectorInputSchema, defaultModelGateway } from '@quanthea/shared';
import { temporaryDir, testServices } from '../test/fixtures.ts';
import { createAgent } from './run.ts';
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
  const failures = { id: 'failures', name: 'Failures', meaning: 'Events at the error level.' };
  await services.definitions.save(failures, null, 'editor-1', 'file');
  ({ id: threadId } = services.threads.create('editor-1', null, undefined, { kind: 'definition' }));
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
  const text = 'Revenue is what customers paid. Failures also count warnings.';
  const message = { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text }] };
  const signal = AbortSignal.timeout(5000);
  await (await agent.chat({ threadId, message, actor: 'editor-1', signal })).text();
  return model;
}

/**
 * The parts of the thread's latest answer.
 *
 * @returns The parts.
 */
function answerParts(): { type: string; data?: unknown; output?: unknown }[] {
  const last = services.threads.get(threadId).messages.at(-1) as { parts?: unknown } | undefined;
  return (last?.parts ?? []) as { type: string; data?: unknown; output?: unknown }[];
}

/**
 * The ids the card of the latest answer proposes, with the version each changes.
 *
 * @returns Each proposal's id and latest version.
 */
function carded(): { id: string; latest: number | null }[] {
  const card = answerParts().find((part) => part.type === 'data-definitionProposals');
  const data = (card?.data ?? { proposals: [] }) as {
    proposals: { definition: { id: string }; latest: number | null }[];
  };
  return data.proposals.map((each) => ({ id: each.definition.id, latest: each.latest }));
}

test('proposes a batch of definitions on a card, saving none, and names a change of one', async () => {
  const definitions = [
    { id: 'revenue', name: 'Revenue', meaning: 'What customers paid, before refunds.' },
    { id: 'failures', name: 'Failures', meaning: 'Events at the error or warning level.' },
  ];
  const model = await turn(
    { tool: 'propose_definitions', input: { definitions } },
    { text: 'Two definitions to save.' },
  );
  const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt);
  expect(prompt).toContain('definitions assistant');
  expect(prompt).toContain('- failures \\"Failures\\": Events at the error level.');
  expect(carded()).toEqual([
    { id: 'revenue', latest: null },
    { id: 'failures', latest: 1 },
  ]);
  expect(services.definitions.list().map((each) => each.version)).toEqual([1]);
  const tool = answerParts().find((part) => part.type === 'tool-propose_definitions');
  expect(tool?.output).toMatchObject({
    proposed: ['revenue (new): meaning only', 'failures (changes v1): meaning only'],
    failed: [],
  });
});

test('tells the model which proposals failed, and shows only those that passed', async () => {
  const definitions = [
    { id: 'revenue', name: 'Revenue', meaning: 'What customers paid.' },
    {
      id: 'errors',
      name: 'Errors',
      meaning: 'Error events.',
      bodies: [
        {
          shape: 'ratio',
          request: { kind: 'sql-stat', table: 'events', measure: { fn: 'count' } },
        },
      ],
    },
  ];
  await turn({ tool: 'propose_definitions', input: { definitions } }, { text: 'One to fix.' });
  expect(carded().map((each) => each.id)).toEqual(['revenue']);
  const tool = answerParts().find((part) => part.type === 'tool-propose_definitions');
  expect(JSON.stringify(tool?.output)).toContain('A ratio cannot be written with sql-stat.');
});
