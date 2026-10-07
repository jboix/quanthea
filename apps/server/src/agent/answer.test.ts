import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  type AccessLevel,
  answerDataSchemas,
  connectorInputSchema,
  type DashboardSpec,
  dashboardSpecSchema,
  defaultModelGateway,
} from '@quanthea/shared';
import { eventsSpec } from '../dashboards/test/events-spec.ts';
import type { AppError } from '../lib/errors.ts';
import { temporaryDir, testServices } from '../test/fixtures.ts';
import type { ModelStep } from '../usage/usage.ts';
import { createAnswers } from './answer.ts';
import type { Answers, AskRequest, ExplainRequest } from './answer-types.ts';
import { type ScriptedStep, scriptedStreamModel } from './test/mock-model.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;
let steps: ModelStep[] = [];

const range = { from: Date.parse('2026-10-03T12:00:00Z'), to: Date.parse('2026-10-03T14:00:00Z') };

beforeEach(async () => {
  dataDir = temporaryDir();
  services = await testServices(dataDir.path);
  await services.modelSettings.save(defaultModelGateway, { anthropic: 'sk-test' }, 'admin-1');
  steps = [];
});

afterEach(async () => {
  await services.close();
  dataDir.remove();
});

/**
 * Adds an in-memory connector at an access level.
 *
 * @param name - Its name.
 * @param accessLevel - Its access level.
 */
async function addConnector(name: string, accessLevel: AccessLevel): Promise<void> {
  const input = { name, kind: 'memory', config: {}, secret: { token: 't' }, accessLevel };
  await services.connections.create(connectorInputSchema.parse(input), 'admin-1');
}

/**
 * The events spec, with a panel over a second connector, `logs`.
 *
 * @returns The spec.
 */
function spec(): DashboardSpec {
  const base = eventsSpec();
  const logs = { refId: 'A', connector: 'logs', language: 'sql', sql: 'SELECT * FROM events' };
  const panel = { ...base.panels[1], id: 'log-errors', title: 'Log errors', queries: [logs] };
  return dashboardSpecSchema.parse({ ...base, panels: [...base.panels, panel] });
}

/**
 * The answering service over the test services, its model answering from a script, its steps
 * recorded.
 *
 * @param script - The model's answers, one per step.
 * @returns The service and the model.
 */
function answersWith(...script: ScriptedStep[]) {
  const model = scriptedStreamModel(...script);
  const usage = {
    recordStep: (step: ModelStep) => {
      steps.push(step);
      services.usage.recordStep(step);
    },
  };
  const answers: Answers = createAnswers({ ...services, usage, buildModel: () => model });
  return { answers, model };
}

/**
 * A question over the range, as a viewer asks it.
 *
 * @param question - The question.
 * @returns The request.
 */
function ask(question: string): AskRequest {
  const base = {
    dashboardId: 'd1',
    spec: spec(),
    actor: 'viewer-1',
    signal: AbortSignal.timeout(5000),
  };
  return { ...base, mode: 'ask', time: range, timeZone: 'Europe/Madrid', variables: {}, question };
}

/**
 * A request to explain a panel.
 *
 * @param panelId - The panel.
 * @returns The request.
 */
function explain(panelId: string): ExplainRequest {
  const signal = AbortSignal.timeout(5000);
  return { mode: 'explain', dashboardId: 'd1', spec: spec(), actor: 'viewer-1', panelId, signal };
}

/**
 * The names of the tools a model call was offered.
 *
 * @param model - The model.
 * @param call - Which call.
 * @returns The names, sorted.
 */
function toolsOffered(model: ReturnType<typeof scriptedStreamModel>, call = 0): string[] {
  return (model.doStreamCalls[call]?.tools ?? []).map((each) => each.name).sort();
}

/**
 * The instructions a model call was given.
 *
 * @param model - The model.
 * @returns The system prompt, as JSON.
 */
function instructionsOf(model: ReturnType<typeof scriptedStreamModel>): string {
  return JSON.stringify(model.doStreamCalls[0]?.prompt[0]);
}

const panelAnswer = (text: string) => ({
  tool: 'give_answer',
  input: { text, citations: [{ n: 1, panelId: 'errors-over-time' }] },
});

describe('the tools offered', () => {
  test('level 2 only: no read tool, and the model is told it cannot read the numbers', async () => {
    await addConnector('events', 2);
    await addConnector('logs', 2);
    const { answers, model } = answersWith(panelAnswer('I cannot read the numbers here [1].'));
    const outcome = await answers.answer(ask('What happened at 13:00?'));
    expect(outcome.ok).toBe(true);
    expect(toolsOffered(model)).toEqual(['describe', 'give_answer']);
    expect(instructionsOf(model)).toContain('You cannot read the numbers of this dashboard');
    expect(model.doStreamCalls[0]?.toolChoice).toEqual({ type: 'required' });
  });

  test('the read tool reaches only the connectors at aggregates or full access', async () => {
    await addConnector('events', 3);
    await addConnector('logs', 2);
    const { answers, model } = answersWith(
      { tool: 'read_data', input: { panelId: 'log-errors' } },
      panelAnswer('Errors over time is the panel to watch [1].'),
    );
    const outcome = await answers.answer(ask('Any errors?'));
    expect(toolsOffered(model)).toEqual(['describe', 'give_answer', 'read_data']);
    const read = model.doStreamCalls[0]?.tools?.find((each) => each.name === 'read_data');
    expect(JSON.stringify(read)).toContain('"enum":["events"]');
    expect(instructionsOf(model)).toContain(
      'logs (memory, sql): level 2: you cannot read its numbers.',
    );
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain(
      'You cannot read \\"logs\\": its access level shows no numbers.',
    );
    expect(outcome.ok && outcome.answer.evidence).toEqual([]);
  });

  test('explain mode never offers the read tool, even at full access, nor the range', async () => {
    await addConnector('events', 4);
    await addConnector('logs', 4);
    const { answers, model } = answersWith(panelAnswer('It counts errors per minute [1].'));
    const outcome = await answers.answer(explain('errors-over-time'));
    expect(toolsOffered(model)).toEqual(['describe', 'give_answer']);
    expect(instructionsOf(model)).toContain('You have no data and must not quote any');
    expect(instructionsOf(model)).not.toContain('range asked about:');
    expect(outcome.ok && outcome.answer.mode).toBe('explain');
  });

  test('refuses to explain a panel the version does not have', async () => {
    const { answers } = answersWith();
    const failure = await answers.answer(explain('nope')).catch((error: AppError) => error);
    expect(failure).toMatchObject({ code: 'not_found' });
  });
});

describe('evidence and citations', () => {
  test('records each read with its query, variables, window and the gate output', async () => {
    await addConnector('events', 3);
    await addConnector('logs', 3);
    const window = { from: '2026-10-03T12:00:00Z', to: '2026-10-03T12:04:00Z' };
    const { answers, model } = answersWith(
      { tool: 'read_data', input: { panelId: 'errors-over-time', time: window } },
      {
        tool: 'give_answer',
        input: {
          text: 'Errors rose to 8 at 14:04 [1].',
          citations: [{ n: 1, evidenceId: 'e1', panelId: 'errors-over-time', ...window }],
        },
      },
    );
    const outcome = await answers.answer(ask('When did errors peak?'));
    if (!outcome.ok) throw new Error(outcome.message);
    const [evidence] = outcome.answer.evidence;
    expect(evidence).toMatchObject({
      id: 'e1',
      connector: 'events',
      panelId: 'errors-over-time',
      query: { sql: 'SELECT * FROM events' },
      variables: { env: 'prod', order: 'A-1' },
      time: { from: '2026-10-03T12:00:00.000Z', to: '2026-10-03T12:04:00.000Z' },
    });
    const errors = JSON.stringify(evidence?.result);
    expect(errors).toContain('"maxAt":"2026-10-03T12:04:00.000Z"');
    expect(errors).not.toContain('"rows"');
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain('{"evidenceId":"e1",');
  });

  test('gives one repair try, then a clean failure', async () => {
    await addConnector('events', 3);
    await addConnector('logs', 3);
    const wrong = {
      tool: 'give_answer',
      input: { text: 'Errors peaked [1] [2].', citations: [{ n: 1, panelId: 'nope' }] },
    };
    const { answers, model } = answersWith(wrong, wrong, panelAnswer('Never reached [1].'));
    const outcome = await answers.answer(ask('When did errors peak?'));
    expect(outcome).toMatchObject({ ok: false, evidence: [] });
    expect(model.doStreamCalls).toHaveLength(2);
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain(
      '[2] is in the text, uncited.',
    );
  });

  test('accepts the repaired answer', async () => {
    await addConnector('events', 3);
    await addConnector('logs', 3);
    const outside = {
      n: 1,
      panelId: 'errors-over-time',
      from: '2026-10-02T12:00:00Z',
      to: '2026-10-02T13:00:00Z',
    };
    const { answers } = answersWith(
      { tool: 'give_answer', input: { text: 'Yesterday [1].', citations: [outside] } },
      panelAnswer('Nothing stands out [1].'),
    );
    const outcome = await answers.answer(ask('Anything odd?'));
    expect(outcome.ok && outcome.answer.text).toBe('Nothing stands out [1].');
  });
});

describe('usage and streaming', () => {
  test('records every step as the answer job, against who asked', async () => {
    await addConnector('events', 3);
    await addConnector('logs', 3);
    const { answers } = answersWith(
      { tool: 'read_data', input: { panelId: 'errors-peak' } },
      panelAnswer('Fine [1].'),
    );
    const outcome = await answers.answer(ask('All good?'));
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ job: 'answer', userId: 'viewer-1', dashboardId: 'd1' });
    expect(steps.map((step) => step.feature)).toEqual(['question', 'question']);
    expect(services.usage.report(1).buckets.map((bucket) => bucket.userId)).toEqual(['viewer-1']);
    expect(outcome.usage).toEqual({
      'claude-haiku-4-5': { input: 20, cachedInput: 0, cacheWrite: 0, output: 10 },
    });
  });

  test('records the steps of a panel explanation as the answer job, as an explanation', async () => {
    const { answers } = answersWith(panelAnswer('It counts errors per minute [1].'));
    await answers.answer(explain('errors-over-time'));
    expect(steps.map((step) => [step.job, step.feature])).toEqual([['answer', 'explanation']]);
    const features = services.usage.report(1).buckets.map((bucket) => bucket.feature);
    expect(features).toEqual(['explanation']);
  });

  test('records the provider name and the vendor its base URL reaches', async () => {
    const [anthropic] = defaultModelGateway.providers;
    if (!anthropic) throw new Error('The default gateway has a provider.');
    const openRouter = {
      ...anthropic,
      provider: 'openai-compatible' as const,
      baseUrl: 'https://openrouter.ai/api/v1',
    };
    const gateway = { ...defaultModelGateway, providers: [openRouter] };
    await services.modelSettings.save(gateway, {}, 'admin-1');
    const { answers } = answersWith(panelAnswer('It counts errors per minute [1].'));
    await answers.answer(explain('errors-over-time'));
    expect(steps.map((step) => [step.provider, step.vendor])).toEqual([
      ['Anthropic', 'openrouter'],
    ]);
    const [bucket] = services.usage.report(1).buckets;
    expect(bucket).toMatchObject({ provider: 'Anthropic', vendor: 'openrouter' });
  });

  test('streams the reads and the outcome as data parts, as threads stream', async () => {
    await addConnector('events', 3);
    await addConnector('logs', 3);
    const { answers } = answersWith(
      { tool: 'read_data', input: { panelId: 'errors-peak' } },
      panelAnswer('Fine [1].'),
    );
    let stored: unknown;
    const response = await answers.stream(ask('All good?'), (outcome) => {
      stored = outcome;
    });
    const parts = (await response.text())
      .split('\n')
      .filter((line) => line.startsWith('data: {'))
      .map((line) => JSON.parse(line.slice('data: '.length)) as { type: string; data?: unknown });
    const evidence = parts.find((part) => part.type === 'data-evidence');
    const outcome = parts.find((part) => part.type === 'data-outcome');
    expect(answerDataSchemas.evidence.parse(evidence?.data).id).toBe('e1');
    expect(answerDataSchemas.outcome.parse(outcome?.data)).toMatchObject({ ok: true });
    expect(stored).toMatchObject({ ok: true, answer: { text: 'Fine [1].' } });
    // The outcome comes after every part of the model's message, and only the finish follows it.
    const types = parts.map((part) => part.type);
    expect(types.slice(-2)).toEqual(['data-outcome', 'finish']);
    expect(types.filter((type) => type === 'finish')).toHaveLength(1);
    expect(types.indexOf('tool-output-available')).toBeLessThan(types.indexOf('data-outcome'));
    expect(parts.at(-1)).toMatchObject({ messageMetadata: { usage: { 'claude-haiku-4-5': {} } } });
  });
});

describe('what the model sees and when', () => {
  test('explain mode describes the schema as level 1 shows it, whatever the level', async () => {
    await addConnector('events', 4);
    await addConnector('logs', 4);
    const describe = { tool: 'describe', input: { connector: 'events' } };
    const explaining = answersWith(describe, panelAnswer('It counts errors [1].'));
    await explaining.answers.answer(explain('errors-over-time'));
    const explained = JSON.stringify(explaining.model.doStreamCalls[1]?.prompt);
    expect(explained).toContain('"name":"service"');
    expect(explained).not.toContain('"rows"');
    expect(explained).not.toContain('distinctValues');
    const asking = answersWith(describe, panelAnswer('Errors over time [1].'));
    await asking.answers.answer(ask('What is there?'));
    expect(JSON.stringify(asking.model.doStreamCalls[1]?.prompt)).toContain('"rows":5');
  });

  test('refuses an answer given in the same step as a read, whatever their order', async () => {
    await addConnector('events', 3);
    await addConnector('logs', 3);
    const early = {
      tool: 'give_answer',
      input: { text: 'Fine [1].', citations: [{ n: 1, panelId: 'errors-peak' }] },
    };
    const read = { tool: 'read_data', input: { panelId: 'errors-peak' } };
    const cited = { n: 1, evidenceId: 'e1', panelId: 'errors-peak' };
    const { answers, model } = answersWith(
      { calls: [early, read] },
      { tool: 'give_answer', input: { text: 'Errors peaked at 8 [1].', citations: [cited] } },
    );
    const outcome = await answers.answer(ask('What was the peak?'));
    const second = JSON.stringify(model.doStreamCalls[1]?.prompt);
    expect(second).toContain('Answer in a step of its own, after your reads');
    expect(outcome.ok && outcome.answer.text).toBe('Errors peaked at 8 [1].');
    expect(outcome.ok && outcome.answer.evidence.map((evidence) => evidence.id)).toEqual(['e1']);
  });
});
