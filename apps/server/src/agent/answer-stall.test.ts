import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { connectorInputSchema, dashboardSpecSchema, defaultModelGateway } from '@quanthea/shared';
import { eventsSpec } from '../dashboards/test/events-spec.ts';
import { captureLogs, temporaryDir, testServices } from '../test/fixtures.ts';
import { createAnswers } from './answer.ts';
import type { AskRequest } from './answer-types.ts';
import { type ScriptedStep, scriptedStreamModel } from './test/mock-model.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;
let log: ReturnType<typeof captureLogs>;

const range = { from: Date.parse('2026-10-03T12:00:00Z'), to: Date.parse('2026-10-03T14:00:00Z') };

beforeEach(async () => {
  dataDir = temporaryDir();
  log = captureLogs();
  services = await testServices(dataDir.path);
  await services.modelSettings.save(defaultModelGateway, { anthropic: 'sk-test' }, 'admin-1');
  const input = { name: 'events', kind: 'memory', config: {}, secret: { token: 't' } };
  await services.connections.create(connectorInputSchema.parse({ ...input, accessLevel: 3 }), 'a');
});

afterEach(async () => {
  await services.close();
  dataDir.remove();
});

/**
 * The answering service over the test services, its model answering from a script.
 *
 * @param script - The model's answers, one per step.
 * @returns The service and the model.
 */
function answersWith(...script: ScriptedStep[]) {
  const model = scriptedStreamModel(...script);
  const { logger } = log;
  return { answers: createAnswers({ ...services, buildModel: () => model, logger }), model };
}

/**
 * A question over the range.
 *
 * @returns The request.
 */
function ask(): AskRequest {
  const signal = AbortSignal.timeout(5000);
  const spec = dashboardSpecSchema.parse(eventsSpec());
  const base = { dashboardId: 'd1', spec, actor: 'viewer-1', signal };
  const question = 'When is traffic highest?';
  return { ...base, mode: 'ask', time: range, timeZone: 'Europe/Madrid', variables: {}, question };
}

/**
 * What a model call was sent: its tools, its tool choice and its prompt as JSON.
 *
 * @param model - The model.
 * @param call - Which call.
 * @returns The call's settings.
 */
function sent(model: ReturnType<typeof scriptedStreamModel>, call: number) {
  const options = model.doStreamCalls[call];
  const tools = (options?.tools ?? []).map((each) => each.name);
  return { tools, toolChoice: options?.toolChoice, prompt: JSON.stringify(options?.prompt) };
}

const read = { tool: 'read_data', input: { panelId: 'errors-over-time' } };

const cited = {
  tool: 'give_answer',
  input: {
    text: 'Errors peak at 14:04 [1].',
    citations: [{ n: 1, evidenceId: 'e1', panelId: 'errors-over-time' }],
  },
};

const cut = { text: '', finish: 'length', raw: 'MAX_TOKENS' } as const;

describe('a step that calls no tool', () => {
  test('is followed by a step that may only answer, from the evidence already read', async () => {
    const { answers, model } = answersWith(read, { text: 'It peaks in the afternoon.' }, cited);
    const outcome = await answers.answer(ask());
    expect(outcome).toMatchObject({ ok: true, answer: { text: 'Errors peak at 14:04 [1].' } });
    expect(outcome.ok && outcome.answer.evidence).toHaveLength(1);
    expect(model.doStreamCalls).toHaveLength(3);
    const forced = sent(model, 2);
    expect(forced.tools).toEqual(['give_answer']);
    expect(forced.toolChoice).toEqual({ type: 'tool', toolName: 'give_answer' });
    expect(forced.prompt).toContain('{"evidenceId":"e1",');
    expect(forced.prompt).not.toContain('It peaks in the afternoon.');
  });

  test('gives the forced answer its repair try', async () => {
    const malformed = { text: '', finish: 'other', raw: 'MALFORMED_FUNCTION_CALL' } as const;
    const wrong = { tool: 'give_answer', input: { text: 'Errors peak [1].', citations: [] } };
    const { answers, model } = answersWith(read, malformed, wrong, cited, cited);
    const outcome = await answers.answer(ask());
    expect(outcome).toMatchObject({ ok: true, answer: { text: 'Errors peak at 14:04 [1].' } });
    expect(model.doStreamCalls).toHaveLength(4);
    expect(sent(model, 3).tools).toEqual(['give_answer']);
  });

  test('says the output was cut when the forced step is cut too, and keeps the reads', async () => {
    const { answers, model } = answersWith(read, cut, cut, cited);
    const outcome = await answers.answer(ask());
    expect(outcome).toMatchObject({
      ok: false,
      ending: 'cut',
      finishReason: 'MAX_TOKENS',
      message:
        "The model's output was cut at its limit before it gave an answer, even when asked once more to answer from what it had read. Try asking more narrowly.",
    });
    expect(!outcome.ok && outcome.evidence).toHaveLength(1);
    expect(model.doStreamCalls).toHaveLength(3);
  });

  test('logs the ending and the provider’s reason, which the message leaves out', async () => {
    const { answers } = answersWith(read, cut, cut);
    const outcome = await answers.answer(ask());
    expect(!outcome.ok && outcome.message).not.toContain('MAX_TOKENS');
    expect(log.lines).toMatchObject([
      {
        level: 'warn',
        message: 'an answer ended with none',
        mode: 'ask',
        dashboardId: 'd1',
        ending: 'cut',
        finishReason: 'MAX_TOKENS',
      },
    ]);
  });

  test('logs nothing for an answer that came', async () => {
    const { answers } = answersWith(read, cited);
    expect(await answers.answer(ask())).toMatchObject({ ok: true });
    expect(log.lines).toEqual([]);
  });

  test('says the provider withheld the response when its content filter ends both passes', async () => {
    const withheld = { text: '', finish: 'content-filter', raw: 'SAFETY' } as const;
    const { answers, model } = answersWith(read, withheld, withheld);
    const outcome = await answers.answer(ask());
    expect(outcome).toMatchObject({
      ok: false,
      ending: 'withheld',
      finishReason: 'SAFETY',
      message:
        "The model's provider withheld the response, even when asked once more to answer from what it had read. Try asking more narrowly.",
    });
    expect(!outcome.ok && outcome.evidence).toHaveLength(1);
    expect(model.doStreamCalls).toHaveLength(3);
  });

  test('says which ending it was: nothing at all, or a call that could not be read', async () => {
    const silent = answersWith({ text: '' }, { text: '' });
    expect(await silent.answers.answer(ask())).toMatchObject({
      ok: false,
      ending: 'silent',
      message:
        'The model stopped without giving an answer, even when asked once more to answer from what it had read. Try again.',
    });
    const malformed = { text: '', finish: 'other', raw: 'MALFORMED_FUNCTION_CALL' } as const;
    const unread = answersWith(read, malformed, malformed);
    const outcome = await unread.answers.answer(ask());
    expect(outcome).toMatchObject({ ok: false, ending: 'malformed' });
    expect(!outcome.ok && outcome.message).toContain('a tool call that could not be read');
  });

  test('answers refused twice stay a refusal, with no further step', async () => {
    const wrong = { tool: 'give_answer', input: { text: 'Errors peak [1].', citations: [] } };
    const { answers, model } = answersWith(wrong, wrong, cited);
    const outcome = await answers.answer(ask());
    expect(outcome).toMatchObject({ ok: false, ending: 'refused' });
    expect(!outcome.ok && outcome.message).toContain('did not hold up against its evidence');
    expect(model.doStreamCalls).toHaveLength(2);
  });

  test('streams one message: no error part, one start, the outcome last', async () => {
    const { answers } = answersWith(read, cut, cited);
    const response = await answers.stream(ask(), () => undefined);
    const parts = (await response.text())
      .split('\n')
      .filter((line) => line.startsWith('data: {'))
      .map((line) => JSON.parse(line.slice('data: '.length)) as { type: string; data?: unknown });
    const types = parts.map((part) => part.type);
    expect(types).not.toContain('error');
    expect(types.filter((type) => type === 'start')).toHaveLength(1);
    expect(types.slice(-2)).toEqual(['data-outcome', 'finish']);
    expect(parts.at(-2)?.data).toMatchObject({ ok: true });
  });
});

describe('the limits of one answer', () => {
  /**
   * Lowers the tool call limit to one call.
   */
  async function oneCall(): Promise<void> {
    const limits = { ...defaultModelGateway.limits, toolCallsPerTurn: 1 };
    const gateway = { ...defaultModelGateway, limits };
    await services.modelSettings.save(gateway, { anthropic: 'sk-test' }, 'admin-1');
  }

  test('a step past the limit that calls no tool names the limit', async () => {
    await oneCall();
    const { answers, model } = answersWith(read, { text: '' }, { text: '' });
    const outcome = await answers.answer(ask());
    expect(sent(model, 1).tools).toEqual(['give_answer']);
    expect(outcome).toMatchObject({
      ok: false,
      ending: 'silent',
      limit: 'calls',
      message:
        'The tool calls of one answer were used up, so the model could only give its answer. The model stopped without giving an answer, even when asked once more to answer from what it had read. Try asking more narrowly.',
    });
    expect(log.lines[0]).toMatchObject({ ending: 'silent', limit: 'calls' });
  });

  test('a step within the limits that calls no tool names none', async () => {
    const { answers } = answersWith(read, { text: '' }, { text: '' });
    const outcome = await answers.answer(ask());
    expect(outcome).not.toHaveProperty('limit');
    expect(!outcome.ok && outcome.message).not.toContain('used up');
  });

  test('one step of many calls ends the run on the limit', async () => {
    await oneCall();
    const { answers, model } = answersWith({ calls: [read, read, read] }, cited);
    const outcome = await answers.answer(ask());
    expect(outcome).toMatchObject({
      ok: false,
      ending: 'limit',
      message: 'No answer came within the limits of one answer. Try asking more narrowly.',
    });
    expect(!outcome.ok && outcome.evidence).toHaveLength(3);
    expect(model.doStreamCalls).toHaveLength(1);
    expect(log.lines[0]).toMatchObject({ ending: 'limit' });
  });
});
