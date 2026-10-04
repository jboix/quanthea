import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  type AccessLevel,
  connectorInputSchema,
  dashboardSpecSchema,
  defaultModelGateway,
  type PanelRun,
} from '@quanthea/shared';
import { frameOf } from '../alerts/test/fixtures.ts';
import { eventsSpec } from '../dashboards/test/events-spec.ts';
import { temporaryDir, testServices } from '../test/fixtures.ts';
import { createAnswers } from './answer.ts';
import type { AskRequest } from './answer-types.ts';
import { type ScriptedStep, scriptedStreamModel } from './test/mock-model.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;

/** The run's period, and the week before. */
const period = { from: Date.parse('2026-09-28T22:00:00Z'), to: Date.parse('2026-10-05T21:59:59Z') };
const before = { from: period.from - 7 * 86_400_000, to: period.to - 7 * 86_400_000 };

/** A number only the frozen results hold, to tell whether the model saw values. */
const marker = 98_765;

beforeEach(async () => {
  dataDir = temporaryDir();
  services = await testServices(dataDir.path);
  await services.modelSettings.save(defaultModelGateway, { anthropic: 'sk-test' }, 'admin-1');
});

afterEach(async () => {
  await services.close();
  dataDir.remove();
});

/**
 * Adds the in-memory `events` connector at an access level, and `logs` at level 1.
 *
 * @param accessLevel - The level of `events`.
 */
async function connectorsAt(accessLevel: AccessLevel): Promise<void> {
  for (const [name, level] of [
    ['events', accessLevel],
    ['logs', 1],
  ] as const) {
    const input = { name, kind: 'memory', config: {}, secret: { token: 't' }, accessLevel: level };
    await services.connections.create(connectorInputSchema.parse(input), 'admin-1');
  }
}

/**
 * A frozen panel run of one query: a time and a count.
 *
 * @param value - The count.
 * @returns The run.
 */
function frozen(value: number): PanelRun {
  const frame = frameOf(
    [
      { name: 'time', type: 'time' },
      { name: 'errors', type: 'number' },
    ],
    [
      [period.from, period.from + 3_600_000],
      [3, value],
    ],
  );
  return {
    time: period,
    queries: [{ refId: 'A', frames: [frame], error: null }],
    markers: [],
    durationMs: 1,
  };
}

/**
 * A question about the run, over the period, with the run's frozen results.
 *
 * @param question - The question.
 * @returns The request.
 */
function askRun(question: string): AskRequest {
  return {
    mode: 'ask',
    dashboardId: null,
    spec: dashboardSpecSchema.parse({ ...eventsSpec(), variables: [] }),
    actor: 'analyst-1',
    signal: AbortSignal.timeout(5000),
    time: period,
    timeZone: 'Europe/Zurich',
    variables: {},
    question,
    run: {
      label: 'week 40, 29 Sep – 5 Oct',
      comparison: { ...before, label: 'week 39, 22 – 28 Sep' },
      panels: { 'errors-over-time': frozen(marker) },
      comparisonPanels: { 'errors-over-time': frozen(12) },
    },
  };
}

/**
 * The answering service, its model answering from a script.
 *
 * @param script - The model's answers, one per step.
 * @returns The service and the model.
 */
function answersWith(...script: ScriptedStep[]) {
  const model = scriptedStreamModel(...script);
  const answers = createAnswers({ ...services, buildModel: () => model });
  return { answers, model };
}

/** Reads the frozen errors over the run's period. */
const readRun = { tool: 'read_run', input: { panelId: 'errors-over-time' } };

/** An answer citing the first read. */
const cited = {
  tool: 'give_answer',
  input: { text: 'Errors rose [1].', citations: [{ n: 1, evidenceId: 'e1' }] },
};

/**
 * What the model received after its first step.
 *
 * @param model - The model.
 * @returns The second call's prompt, as JSON.
 */
function secondPrompt(model: ReturnType<typeof scriptedStreamModel>): string {
  return JSON.stringify(model.doStreamCalls[1]?.prompt);
}

describe('frozen results through the access levels', () => {
  test('level 2: shapes only, no query tool, and the model is told to say so', async () => {
    await connectorsAt(2);
    const { answers, model } = answersWith(readRun, cited);
    const outcome = await answers.answer(askRun('Why did errors rise?'));
    const offered = (model.doStreamCalls[0]?.tools ?? []).map((each) => each.name).sort();
    expect(offered).toEqual(['describe', 'give_answer', 'propose_follow_up', 'read_run']);
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt[0])).toContain(
      'read_run shows the shape of its frozen results, never their numbers',
    );
    const seen = secondPrompt(model);
    expect(seen).toContain('"rowCount":2');
    expect(seen).not.toContain(String(marker));
    expect(seen).not.toContain('"summaries":');
    expect(outcome.ok && outcome.answer.evidence[0]).toMatchObject({ frozen: true, id: 'e1' });
  });

  test('level 3: summaries and a query tool, never the rows', async () => {
    await connectorsAt(3);
    const { answers, model } = answersWith(readRun, cited);
    await answers.answer(askRun('Why did errors rise?'));
    const offered = (model.doStreamCalls[0]?.tools ?? []).map((each) => each.name);
    expect(offered).toContain('read_data');
    const seen = secondPrompt(model);
    expect(seen).toContain('"summaries":');
    expect(seen).toContain(String(marker));
    expect(seen).not.toContain('"rows":');
  });

  test('level 4: the rows; and the comparison reads the period before', async () => {
    await connectorsAt(4);
    const comparison = {
      tool: 'read_run',
      input: { panelId: 'errors-over-time', period: 'comparison' },
    };
    const { answers, model } = answersWith({ calls: [readRun, comparison] }, cited);
    const outcome = await answers.answer(askRun('Compare with the week before.'));
    expect(secondPrompt(model)).toContain('"rows":');
    const times = outcome.ok ? outcome.answer.evidence.map((each) => each.time.from) : [];
    expect(times).toEqual([
      new Date(period.from).toISOString(),
      new Date(before.from).toISOString(),
    ]);
  });

  test('an unknown panel or a missing comparison is refused in words', async () => {
    await connectorsAt(3);
    const request = askRun('Anything?');
    if (!request.run) throw new Error('The request is about a run.');
    const noComparison = { ...request, run: { ...request.run, comparisonPanels: null } };
    const { answers, model } = answersWith(
      { tool: 'read_run', input: { panelId: 'errors-over-time', period: 'comparison' } },
      { tool: 'give_answer', input: { text: 'Nothing to compare.', citations: [] } },
    );
    await answers.answer(noComparison);
    expect(secondPrompt(model)).toContain('This run compares with no period before.');
  });
});

describe('what is worth watching', () => {
  const alert = {
    kind: 'alert' as const,
    title: 'Hourly revenue drop',
    prompt: 'Tell me when hourly revenue falls 40% below the same hour last week, for 30 minutes.',
  };
  const dashboard = {
    kind: 'dashboard' as const,
    title: 'Revenue by provider',
    prompt: 'Revenue per hour by provider.',
  };

  test('the cards come with the answer', async () => {
    await connectorsAt(3);
    const { answers } = answersWith(
      readRun,
      { tool: 'propose_follow_up', input: { cards: [alert, dashboard] } },
      cited,
    );
    const outcome = await answers.answer(askRun('What should we watch?'));
    expect(outcome.ok && outcome.answer.followUps).toEqual([alert, dashboard]);
  });

  test('only alerts and dashboards, at most three, one-line titles, capped prompts', async () => {
    await connectorsAt(3);
    const wrongs = [
      [{ ...alert, kind: 'report' }],
      [alert, alert, alert, alert],
      [{ ...alert, title: 'Two\nlines' }],
      [{ ...alert, prompt: 'x'.repeat(601) }],
      [],
    ];
    for (const cards of wrongs) {
      const { answers, model } = answersWith(
        readRun,
        { tool: 'propose_follow_up', input: { cards } },
        cited,
      );
      const outcome = await answers.answer(askRun('What should we watch?'));
      expect(outcome.ok && outcome.answer.followUps).toBeUndefined();
      expect(JSON.stringify(model.doStreamCalls[2]?.prompt)).toContain('error-text');
    }
  });

  test('a dashboard question is offered neither tool', async () => {
    await connectorsAt(3);
    const plain = { tool: 'give_answer', input: { text: 'Nothing.', citations: [] } };
    const { answers, model } = answersWith(plain);
    const { run: _run, ...request } = askRun('Anything?');
    await answers.answer({ ...request, dashboardId: 'd1' });
    const offered = (model.doStreamCalls[0]?.tools ?? []).map((each) => each.name);
    expect(offered).not.toContain('read_run');
    expect(offered).not.toContain('propose_follow_up');
  });
});
