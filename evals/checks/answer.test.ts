import { describe, expect, test } from 'bun:test';
import { dashboardSpecSchema } from '@quanthea/shared';
import { answerCases } from '../cases/answers.ts';
import { reportOf, scored, scoredCase } from '../core/test/scoring.ts';
import { eventsDashboard } from '../fixtures/events-dashboard.ts';
import { htmlReport, markdownReport } from '../report/render.ts';
import { incidentHour, zurich } from '../world/incident.ts';
import { type AnswerCaseOutcome, answerDefaults, dataNumbers, isAnswer } from './answer.ts';

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
    expect(scoredCase('a1', asked)).toEqual({ pass: true, reasons: [] });
    expect(scoredCase('a2', unreadable)).toEqual({ pass: true, reasons: [] });
    expect(scoredCase('a3', explained)).toEqual({ pass: true, reasons: [] });
    expect(scoredCase('a4', followed)).toEqual({ pass: true, reasons: [] });
  });

  test('ends a call that failed in an error, and says when an outcome has no answer', () => {
    const failed = { ...asked, ok: false, error: 'No panel "x" in this version.' };
    expect(scored(answerDefaults, failed).status).toBe('error');
    const { text: _text, ...noText } = asked;
    const refused = { ...noText, ok: false, message: 'No answer came within the limits.' };
    expect(scoredCase('a1', refused).reasons).toEqual([
      'no answer: No answer came within the limits.',
    ]);
  });

  test('fails an answer that read nothing, or cites no read', () => {
    const unread = { ...asked, evidence: [], toolCalls: { give_answer: 1 } };
    expect(scoredCase('a1', unread).reasons).toEqual(['read no data']);
    const uncited = { ...asked, citations: [{ n: 1, panelId: 'error-rate-by-service' }] };
    expect(scoredCase('a1', uncited).reasons).toEqual(['no citation points at a read']);
  });

  test('fails an answer that misses a topic or does not name two times', () => {
    const vague = { ...asked, text: 'Errors rose around 14:00 [1] [2].' };
    expect(scoredCase('a1', vague).reasons).toEqual([
      'the text never mentions deploy or #481 or release or rollout',
      'the text names no two times',
    ]);
  });

  test('takes a start and a peak as placing what happened in time', () => {
    const placed = {
      ...asked,
      text: 'Deploy #481 went out at 14:02 [2]; errors peaked at 14:14 [1].',
    };
    expect(scoredCase('a1', placed).reasons).toEqual([]);
  });

  test('fails an answer at level 2 that reads, quotes data, or never says it cannot read', () => {
    const reading = { ...unreadable, toolCalls: { read_data: 1 }, evidence: [read] };
    expect(scoredCase('a2', reading).reasons).toEqual(['read data 1 times, expected no read']);
    const quoting = { ...unreadable, text: 'Errors peaked at 8.4%, with 1,240 failed orders.' };
    expect(scoredCase('a2', quoting).reasons).toEqual([
      'the text does not say it cannot read the numbers',
      'the text quotes data: 8.4%, 1,240',
    ]);
  });

  test('fails an explanation that quotes data or carries citations', () => {
    const quoting = { ...explained, text: `${explained.text} It peaked at 0.084 [1].` };
    expect(scoredCase('a3', quoting).reasons).toEqual([
      'the text quotes data: 0.084',
      'the text carries citation markers',
    ]);
    const cited = { ...explained, citations: [{ n: 1, panelId: 'error-rate-by-service' }] };
    expect(scoredCase('a3', cited).reasons).toEqual(['the text carries citation markers']);
  });

  test('fails a follow-up that gives no duration', () => {
    const undated = { ...followed, text: 'It ended with the rollback [1].' };
    const { reasons } = scoredCase('a4', undated);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toStartWith('the text never mentions');
  });

  test('takes a span of two times as a duration', () => {
    const spanned = { ...followed, text: 'It lasted from 14:09 to 14:30 [1].' };
    expect(scoredCase('a4', spanned).reasons).toEqual([]);
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

describe('the case about the busiest hours', () => {
  const eventsRead = { ...read, connector: 'opensearch-events', panelId: 'events-per-hour' };
  const busiest: AnswerCaseOutcome = {
    ...asked,
    id: 'a5',
    evidence: [eventsRead],
    text: 'Traffic peaks between 20:00 and 21:00 [1], and the same hour was the highest on each of the last seven days [1].',
  };

  test('passes an answer that names the hours and says they repeat', () => {
    expect(scoredCase('a5', busiest)).toEqual({ pass: true, reasons: [] });
  });

  test('passes an answer that says the data is too short to tell', () => {
    const short = {
      ...busiest,
      text: 'The busiest hour was 9 pm [1]. The index holds a day and a half, not enough to say it comes back.',
    };
    expect(scoredCase('a5', short).reasons).toEqual([]);
  });

  test('fails an answer with no hour, or with nothing about whether it comes back', () => {
    const vague = { ...busiest, text: 'Traffic is highest in the evening, as it repeats [1].' };
    expect(scoredCase('a5', vague).reasons).toHaveLength(1);
    const once = { ...busiest, text: 'Traffic peaked at 20:00 with 910 events [1].' };
    expect(scoredCase('a5', once).reasons).toHaveLength(1);
  });

  test('is the only case that needs the search connector, and its dashboard is a valid spec', () => {
    const needsSearch = answerCases.filter((each) => each.given.needs?.includes('search'));
    expect(needsSearch.map((each) => each.id)).toEqual(['a5']);
    const spec = dashboardSpecSchema.parse(eventsDashboard);
    expect(spec.panels.map((panel) => panel.id)).toEqual(['events-per-hour']);
  });
});

describe('answer cases in the report', () => {
  test('score by their case, and show their text and reads', () => {
    const report = reportOf([asked]);
    expect(report.results[0]?.trials[0]?.status).toBe('pass');
    expect(isAnswer(asked)).toBe(true);
    const html = htmlReport(report);
    expect(html).toContain(`What happened around ${incidentHour(zurich)}?`);
    expect(html).toContain('e1 · prometheus-dev · panel error-rate-by-service');
    expect(html).toContain('1 read · 2 steps');
    expect(markdownReport(report)).toContain('> Checkout errors spiked from 14:02 to 14:38');
  });
});
