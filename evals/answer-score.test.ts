import { describe, expect, test } from 'bun:test';
import { type AnswerExpectation, answerCases } from './answer-cases.ts';
import { type AnswerCaseOutcome, dataNumbers, isAnswer, scoreAnswer } from './answer-score.ts';
import { incidentHour, zurich } from './questions.ts';
import { htmlReport, markdownReport } from './render.ts';
import { scoreAll } from './report.ts';

/**
 * A case's expectation, by id.
 *
 * @param id - The case's id.
 * @returns Its expectation.
 */
function expectationOf(id: string): AnswerExpectation {
  const found = answerCases.find((each) => each.id === id);
  if (!found) throw new Error(`No case ${id}.`);
  return found.expect;
}

const read = {
  id: 'e1',
  connector: 'prometheus-dev',
  panelId: 'error-rate-by-service',
  time: { from: '2026-10-02T11:30:00.000Z', to: '2026-10-02T13:30:00.000Z' },
  result: '{"series":[{"max":0.084}]}',
};

const asked: AnswerCaseOutcome = {
  kind: 'answer',
  id: 'a1',
  ok: true,
  text: 'Checkout errors spiked from 14:02 to 14:38, peaking at 8.4% [1], right after deploy #481 [2].',
  citations: [
    { n: 1, evidenceId: 'e1', panelId: 'error-rate-by-service' },
    { n: 2, panelId: 'error-rate-by-service' },
  ],
  evidence: [read],
  toolCalls: { read_data: 1, give_answer: 1 },
  steps: 2,
  usage: {},
  durationMs: 3000,
};

const unreadable: AnswerCaseOutcome = {
  ...asked,
  id: 'a2',
  text: 'I cannot read the numbers of this dashboard. Its error rate panel shows the share of 5xx responses of checkout, and its markers show the deploys.',
  citations: [],
  evidence: [],
  toolCalls: { describe: 1, give_answer: 1 },
};

const explained: AnswerCaseOutcome = {
  ...unreadable,
  id: 'a3',
  text: 'This panel shows the error rate of each service: the share of requests answered with a 5xx status, per second over a 1m window.\n\nA rise means more requests fail.',
};

const followed: AnswerCaseOutcome = {
  ...asked,
  id: 'a4',
  text: 'It lasted 36 minutes, from 14:02 to 14:38 [1].',
  citations: [{ n: 1, evidenceId: 'e1' }],
};

describe('scoring an answer case', () => {
  test('passes a good answer of each case', () => {
    expect(scoreAnswer(asked, expectationOf('a1'))).toEqual({ pass: true, reasons: [] });
    expect(scoreAnswer(unreadable, expectationOf('a2'))).toEqual({ pass: true, reasons: [] });
    expect(scoreAnswer(explained, expectationOf('a3'))).toEqual({ pass: true, reasons: [] });
    expect(scoreAnswer(followed, expectationOf('a4'))).toEqual({ pass: true, reasons: [] });
  });

  test('fails a call that failed, or an outcome with no answer, before anything else', () => {
    const failed = { ...asked, ok: false, error: 'No panel "x" in this version.' };
    expect(scoreAnswer(failed, expectationOf('a1')).reasons).toEqual([
      'the call failed: No panel "x" in this version.',
    ]);
    const { text: _text, ...noText } = asked;
    const refused = { ...noText, ok: false, message: 'No answer came within the limits.' };
    expect(scoreAnswer(refused, expectationOf('a1')).reasons).toEqual([
      'no answer: No answer came within the limits.',
    ]);
  });

  test('fails an answer that read nothing, or cites no read', () => {
    const unread = { ...asked, evidence: [], toolCalls: { give_answer: 1 } };
    expect(scoreAnswer(unread, expectationOf('a1')).reasons).toEqual(['read no data']);
    const uncited = { ...asked, citations: [{ n: 1, panelId: 'error-rate-by-service' }] };
    expect(scoreAnswer(uncited, expectationOf('a1')).reasons).toEqual([
      'no citation points at a read',
    ]);
  });

  test('fails an answer that misses a topic or a time range', () => {
    const vague = { ...asked, text: 'Errors rose around 14:00 [1] [2].' };
    expect(scoreAnswer(vague, expectationOf('a1')).reasons).toEqual([
      'the text never mentions deploy or #481 or release or rollout',
      'the text states no time range',
    ]);
  });

  test('fails an answer at level 2 that reads, quotes data, or never says it cannot read', () => {
    const reading = { ...unreadable, toolCalls: { read_data: 1 }, evidence: [read] };
    expect(scoreAnswer(reading, expectationOf('a2')).reasons).toEqual([
      'read data 1 times, expected no read',
    ]);
    const quoting = { ...unreadable, text: 'Errors peaked at 8.4%, with 1,240 failed orders.' };
    expect(scoreAnswer(quoting, expectationOf('a2')).reasons).toEqual([
      'the text does not say it cannot read the numbers',
      'the text quotes data: 8.4%, 1,240',
    ]);
  });

  test('fails an explanation that quotes data or carries citations', () => {
    const quoting = { ...explained, text: `${explained.text} It peaked at 0.084 [1].` };
    expect(scoreAnswer(quoting, expectationOf('a3')).reasons).toEqual([
      'the text quotes data: 0.084',
      'the text carries citation markers',
    ]);
    const cited = { ...explained, citations: [{ n: 1, panelId: 'error-rate-by-service' }] };
    expect(scoreAnswer(cited, expectationOf('a3')).reasons).toEqual([
      'the text carries citation markers',
    ]);
  });

  test('fails a follow-up that gives no duration', () => {
    const undated = { ...followed, text: 'It ended with the rollback [1].' };
    expect(scoreAnswer(undated, expectationOf('a4')).reasons).toEqual([
      'the text never mentions \\d+\\s*(?:min or minute or hour or h\\b) or half an hour',
    ]);
  });
});

describe('the numbers that read as data', () => {
  test('finds percentages, decimals, long counts and counted things', () => {
    expect(dataNumbers('8.4% of requests, 2.9 s, 1,240 or 15000 orders, 42 errors')).toEqual([
      '8.4%',
      '2.9',
      '1,240',
      '15000',
      '42 errors',
    ]);
    expect(dataNumbers('It rose by 3 percent.')).toEqual(['3 percent']);
  });

  test('ignores times, dates, years, markers and numbers inside words', () => {
    const text =
      'From 14:02 to 14:38:10 on 2026-10-02 (2026), the 5xx share of p95 [1] over [1m] after deploy #481.';
    expect(dataNumbers(text)).toEqual([]);
  });
});

describe('answer cases in the report', () => {
  test('score by their case, and show their text and reads', () => {
    const [result] = scoreAll([asked]);
    expect(result?.score.pass).toBe(true);
    expect(isAnswer(asked)).toBe(true);
    const report = {
      startedAt: '2026-10-03T10:00:00.000Z',
      models: { model: 'test-model' },
      cache: { hits: 1, misses: 0 },
      results: scoreAll([asked]),
    };
    const html = htmlReport(report);
    expect(html).toContain(`What happened around ${incidentHour(zurich)}?`);
    expect(html).toContain('e1 · prometheus-dev · panel error-rate-by-service');
    expect(html).toContain('1 read · 2 steps');
    expect(markdownReport(report)).toContain('> Checkout errors spiked from 14:02 to 14:38');
  });
});
