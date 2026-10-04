import { describe, expect, test } from 'bun:test';
import { htmlReport, markdownReport } from './render.ts';
import { scoreAll } from './report.ts';
import { type RunAnswerExpectation, reportCases } from './report-cases.ts';
import {
  isRunAnswer,
  type RunAnswer,
  type RunAnswerCaseOutcome,
  scoreRunAnswer,
} from './run-answer-score.ts';

/**
 * A run case's expectations, by id, in the order it asks.
 *
 * @param id - The case's id.
 * @returns Its expectations.
 */
function expectationsOf(id: string): RunAnswerExpectation[] {
  const found = reportCases.find((each) => each.id === id);
  if (found?.mode !== 'ask') throw new Error(`No run case ${id}.`);
  return found.asks.map((ask) => ask.expect);
}

/** A read of the run's frozen results, as r3's first answer makes it. */
const frozenRead = {
  id: 'e1',
  connector: 'postgres-orders',
  panelId: 'failed',
  time: { from: '2026-10-02T22:00:00.000Z', to: '2026-10-03T21:59:59.999Z' },
  result: '{"fields":["count"]}',
  frozen: true,
};

const stoodOut: RunAnswer = {
  question: 'What stood out yesterday?',
  ok: true,
  text: 'Failed orders jumped during the checkout incident after the deploy [1].',
  citations: [{ n: 1, evidenceId: 'e1', panelId: 'failed' }],
  evidence: [frozenRead],
  followUps: [],
  toolCalls: { read_run: 1, give_answer: 1 },
  steps: 2,
};

const keepAnEye: RunAnswer = {
  question: 'What should we keep an eye on?',
  ok: true,
  text: 'Watch the failed orders.',
  citations: [],
  evidence: [],
  followUps: [
    { kind: 'alert', title: 'Failed orders', prompt: 'Tell me when failed orders pass 5%.' },
  ],
  toolCalls: { propose_follow_up: 1, give_answer: 1 },
  steps: 2,
};

const asked: RunAnswerCaseOutcome = {
  kind: 'run-answer',
  id: 'r3',
  period: 'Sat 3 Oct',
  answers: [stoodOut, keepAnEye],
  usage: {},
  durationMs: 2000,
};

/**
 * The reasons r3 fails with other answers.
 *
 * @param first - The first answer's fields to replace.
 * @param second - The second answer's fields to replace.
 * @returns The reasons.
 */
function r3Reasons(first: Partial<RunAnswer>, second: Partial<RunAnswer> = {}): string[] {
  const answers = [
    { ...stoodOut, ...first },
    { ...keepAnEye, ...second },
  ];
  return [...scoreRunAnswer({ ...asked, answers }, expectationsOf('r3')).reasons];
}

describe('scoreRunAnswer', () => {
  test('passes an answer that cites a frozen read and names the incident, with cards', () => {
    expect(scoreRunAnswer(asked, expectationsOf('r3'))).toEqual({ pass: true, reasons: [] });
  });

  test('fails a case that failed, and a question it never asked', () => {
    const failed = scoreRunAnswer({ ...asked, error: 'r1 made no run' }, expectationsOf('r3'));
    expect(failed.reasons).toEqual(['the case failed: r1 made no run']);
    const half = scoreRunAnswer({ ...asked, answers: [stoodOut] }, expectationsOf('r3'));
    expect(half.reasons).toEqual(['answer 2: the question was not asked']);
  });

  test('fails an answer that is missing', () => {
    const { text: _text, ...empty } = stoodOut;
    expect(r3Reasons({ ...empty, ok: false, message: 'citations failed' })).toEqual([
      'answer 1: no answer: citations failed',
    ]);
  });

  test('fails no frozen read, and a frozen read never cited', () => {
    expect(r3Reasons({ evidence: [{ ...frozenRead, frozen: false }] })).toEqual([
      'answer 1: read none of the run’s frozen results',
    ]);
    expect(r3Reasons({ citations: [{ n: 1, panelId: 'failed' }] })).toEqual([
      'answer 1: no citation points at a frozen read',
    ]);
  });

  test('fails a text that names neither the failures nor the incident', () => {
    expect(r3Reasons({ text: 'Revenue grew [1].' })).toEqual([
      'answer 1: the text never mentions fail or error',
      expect.stringMatching(/^answer 1: the text never mentions incident or outage/),
    ]);
  });

  test('fails no follow-up card, too many, and a card without a prompt', () => {
    expect(r3Reasons({}, { followUps: [] })).toEqual([
      'answer 2: 0 follow-up cards, expected 1 to 3',
    ]);
    const card = keepAnEye.followUps[0];
    if (!card) throw new Error('No card.');
    expect(r3Reasons({}, { followUps: [card, card, card, card] })).toEqual([
      'answer 2: 4 follow-up cards, expected 1 to 3',
    ]);
    expect(r3Reasons({}, { followUps: [{ ...card, prompt: ' ' }] })).toEqual([
      'answer 2: a follow-up card has no prompt',
    ]);
  });

  test('passes r4 when it says it sees the shape only and quotes no number', () => {
    const shapes = {
      ...stoodOut,
      text: 'I see the shape of the results, not their numbers. An admin can raise the level.',
    };
    const outcome = { ...asked, id: 'r4', answers: [shapes] };
    expect(scoreRunAnswer(outcome, expectationsOf('r4'))).toEqual({ pass: true, reasons: [] });
  });

  test('fails r4 when it quotes data and never says it cannot read the numbers', () => {
    const quoting = { ...stoodOut, text: 'Failed orders reached 1,012, or 1.6% of attempts.' };
    const outcome = { ...asked, id: 'r4', answers: [quoting] };
    expect(scoreRunAnswer(outcome, expectationsOf('r4')).reasons).toEqual([
      'the text does not say it cannot read the numbers',
      'the text quotes data: 1.6%, 1,012',
    ]);
  });
});

describe('the report of a run case', () => {
  test('scores it again and shows each answer, its reads and its cards', () => {
    const results = scoreAll([asked]);
    expect(results[0]?.score.pass).toBe(true);
    expect(isRunAnswer(asked)).toBe(true);
    const report = {
      startedAt: '2026-10-04T10:00:00.000Z',
      models: { model: 'gemini-3.5-flash-lite' },
      cache: { hits: 0, misses: 0 },
      results,
    };
    const markdown = markdownReport(report);
    expect(markdown).toContain('About the run over Sat 3 Oct.');
    expect(markdown).toContain('e1 · frozen read · postgres-orders · panel failed');
    expect(markdown).toContain(
      'Follow-up (alert): Failed orders: “Tell me when failed orders pass 5%.”',
    );
    expect(htmlReport(report)).toContain('What should we keep an eye on?');
  });
});
