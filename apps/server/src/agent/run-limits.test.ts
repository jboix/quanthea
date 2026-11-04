import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { connectorInputSchema, defaultModelGateway, type ModelSettings } from '@quanthea/shared';
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
  ({ id: threadId } = services.threads.create('editor-1'));
});

afterEach(async () => {
  await services.close();
  dataDir.remove();
});

/**
 * Saves the default gateway with some limits changed.
 *
 * @param limits - The limits to change.
 */
async function limitsOf(limits: Partial<ModelSettings['limits']>): Promise<void> {
  const gateway = { ...defaultModelGateway, limits: { ...defaultModelGateway.limits, ...limits } };
  await services.modelSettings.save(gateway, { anthropic: 'sk-test' }, 'admin-1');
}

/**
 * Sends a message to an agent whose model answers from a script, and reads the whole stream.
 *
 * @param message - The message.
 * @param steps - The model's answers, one per step.
 * @returns The stream's text and the model.
 */
async function chatWith(message: unknown, ...steps: ScriptedStep[]) {
  const model = scriptedStreamModel(...steps);
  const agent = createAgent({ ...services, buildModel: () => model });
  const response = await agent.chat({
    threadId,
    message,
    actor: 'editor-1',
    signal: AbortSignal.timeout(5000),
  });
  return { stream: await response.text(), model };
}

/** A message of the person. */
const question = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Errors by service?' }] };

/** A step that reads the events connector. */
const describeEvents: ScriptedStep = { tool: 'describe', input: { connector: 'events' } };

describe('the soft limits of a turn', () => {
  test('never pause a turn by default', async () => {
    expect(defaultModelGateway.limits).toMatchObject({
      tokensPerTurn: null,
      toolCallsPerTurn: null,
    });
    const { stream, model } = await chatWith(
      question,
      describeEvents,
      describeEvents,
      describeEvents,
      { text: 'Which service?' },
    );
    expect(model.doStreamCalls).toHaveLength(4);
    expect(stream).not.toContain('data-limit');
  });

  test('pause at the tool call limit with the limit at the end of the answer', async () => {
    await limitsOf({ toolCallsPerTurn: 2 });
    const { stream, model } = await chatWith(question, describeEvents, describeEvents, {
      text: 'This step never runs.',
    });
    expect(model.doStreamCalls).toHaveLength(2);
    expect(stream).toContain('{"type":"data-limit","data":{"kind":"calls","limit":2,"used":2}}');
    const [, answer] = services.threads.get(threadId).messages as {
      id: string;
      parts: { type: string }[];
    }[];
    expect(answer?.parts.at(-1)?.type).toBe('data-limit');
  });

  test('let the person continue a paused turn, with fresh counts', async () => {
    await limitsOf({ toolCallsPerTurn: 1 });
    const first = await chatWith(question, describeEvents, { text: 'never' });
    expect(first.stream).toContain('"kind":"calls"');
    const [, answer] = services.threads.get(threadId).messages as { id: string }[];
    const next = await chatWith({ id: answer?.id, role: 'assistant', parts: [] }, describeEvents, {
      text: 'never',
    });
    // The continued turn counts again from none: one more call, then it pauses again.
    expect(next.model.doStreamCalls).toHaveLength(1);
    expect(next.stream).toContain('"used":1');
  });

  test('do not pause a turn that ends on its own', async () => {
    await limitsOf({ toolCallsPerTurn: 1 });
    const { stream } = await chatWith(question, { text: 'Which service?' });
    expect(stream).not.toContain('data-limit');
  });
});
