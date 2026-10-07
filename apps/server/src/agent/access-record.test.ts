import { afterEach, beforeEach, expect, test } from 'bun:test';
import { connectorInputSchema, defaultModelGateway } from '@quanthea/shared';
import { temporaryDir, testServices } from '../test/fixtures.ts';
import { createAgent } from './run.ts';
import { type ScriptedStep, scriptedStreamModel } from './test/mock-model.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;
let threadId = '';
let connectorId = '';

beforeEach(async () => {
  dataDir = temporaryDir();
  services = await testServices(dataDir.path);
  const input = { name: 'events', kind: 'memory', config: {}, secret: { token: 't' } };
  const parsed = connectorInputSchema.parse({ ...input, accessLevel: 3 });
  ({ id: connectorId } = await services.connections.create(parsed, 'admin-1'));
  await services.modelSettings.save(defaultModelGateway, { anthropic: 'sk-test' }, 'admin-1');
  ({ id: threadId } = services.threads.create('editor-1'));
});

afterEach(async () => {
  await services.close();
  dataDir.remove();
});

/**
 * Sends a message to an agent whose model answers from a script.
 *
 * @param id - The message id.
 * @param steps - The model's answers, one per step.
 * @returns The scripted model, with the calls it got.
 */
async function chat(id: string, ...steps: ScriptedStep[]) {
  const model = scriptedStreamModel(...steps);
  const agent = createAgent({ ...services, buildModel: () => model });
  const message = { id, role: 'user', parts: [{ type: 'text', text: 'Events?' }] };
  const signal = AbortSignal.timeout(5000);
  const response = await agent.chat({ threadId, message, actor: 'editor-1', signal });
  await response.text();
  return model;
}

/** A description of the events. */
const describeRun: ScriptedStep = { tool: 'describe', input: { connector: 'events' } };

/** A sample of the events' services. */
const sampleRun: ScriptedStep = {
  tool: 'sample_values',
  input: { connector: 'events', entity: 'events', field: 'service' },
};

/**
 * The stored parts of a type.
 *
 * @param type - The part type.
 * @returns The parts.
 */
function storedParts(type: string): Record<string, unknown>[] {
  const messages = services.threads.get(threadId).messages as { parts: { type: string }[] }[];
  return messages.flatMap((message) => message.parts.filter((part) => part.type === type));
}

test('a data tool result records its connector and the access level it ran at', async () => {
  await chat('u1', describeRun, sampleRun, { text: 'Ok.' });
  const records = storedParts('data-sourceAccess');
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ data: { connectorId, level: 3, hidden: [] } });
});

test('the record never reaches the model', async () => {
  await chat('u1', describeRun, { text: 'Ok.' });
  const model = await chat('u2', { text: 'Still ok.' });
  const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt);
  expect(prompt).not.toContain('sourceAccess');
  expect(prompt).not.toContain(connectorId);
});

test('a result read after an access change records the new access', async () => {
  await chat('u1', describeRun, { text: 'Ok.' });
  await services.connections.update(connectorId, { accessLevel: 2 }, 'admin-1');
  await chat('u2', describeRun, { text: 'Ok.' });
  const levels = storedParts('data-sourceAccess').map(
    (part) => (part.data as { level: number }).level,
  );
  expect(levels).toEqual([3, 2]);
});
