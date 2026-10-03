import { describe, expect, test } from 'bun:test';
import { type AnswerScope, answerIssues } from './answer-check.ts';

const range = { from: Date.parse('2026-10-03T12:00:00Z'), to: Date.parse('2026-10-03T14:00:00Z') };

const scope: AnswerScope = {
  panelIds: new Set(['errors', 'latency']),
  evidenceIds: new Set(['e1']),
  range,
};

describe('answerIssues', () => {
  test('passes an answer whose markers and citations match and point at real things', () => {
    const citations = [
      { n: 1, evidenceId: 'e1', panelId: 'errors' },
      { n: 2, panelId: 'latency', from: '2026-10-03T13:05:00Z', to: '2026-10-03T13:20:00+00:00' },
    ];
    expect(answerIssues({ text: 'Errors peaked [1], latency too [2].', citations }, scope)).toEqual(
      [],
    );
  });

  test('finds a marker without a citation, and a citation without a marker', () => {
    const issues = answerIssues(
      {
        text: 'Errors peaked [1] and [3].',
        citations: [
          { n: 1, panelId: 'errors' },
          { n: 2, panelId: 'errors' },
        ],
      },
      scope,
    );
    expect(issues).toEqual(['[3] is in the text, uncited.', 'Citation 2 has no [2].']);
  });

  test('finds a repeated citation and one that points at nothing', () => {
    const citations = [{ n: 1, panelId: 'errors' }, { n: 1 }];
    expect(answerIssues({ text: 'See [1].', citations }, scope)).toEqual([
      'Citation 1 is given more than once.',
      '[1]: point at a read (evidenceId), a panel (panelId), or both.',
    ]);
  });

  test('refuses an unknown read and an unknown panel', () => {
    const citations = [{ n: 1, evidenceId: 'e7', panelId: 'checkout' }];
    expect(answerIssues({ text: 'See [1].', citations }, scope)).toEqual([
      '[1]: no read has evidenceId "e7" (reads: e1).',
      '[1]: the dashboard has no panel "checkout" (panels: errors, latency).',
    ]);
  });

  test('refuses a window outside the range asked about, backwards, unreadable or half given', () => {
    const window = (from?: string, to?: string) =>
      answerIssues({ text: 'At [1].', citations: [{ n: 1, panelId: 'errors', from, to }] }, scope);
    expect(window('2026-10-03T11:00:00Z', '2026-10-03T12:30:00Z')).toEqual([
      '[1]: the window must lie within the range asked about, 2026-10-03T12:00:00.000Z to 2026-10-03T14:00:00.000Z.',
    ]);
    expect(window('2026-10-03T13:30:00Z', '2026-10-03T13:00:00Z')).toEqual([
      '[1]: the window ends before it starts.',
    ]);
    expect(window('at two', '2026-10-03T13:00:00Z')).toEqual([
      '[1]: from and to must be ISO 8601 times with an offset.',
    ]);
    expect(window('2026-10-03T13:00:00Z')).toEqual(['[1]: give both from and to, or neither.']);
  });

  test('gives an explanation no time window', () => {
    const citations = [
      { n: 1, panelId: 'errors', from: '2026-10-03T13:00:00Z', to: '2026-10-03T13:10:00Z' },
    ];
    const explaining = { ...scope, evidenceIds: new Set<string>(), range: undefined };
    expect(answerIssues({ text: 'It counts errors [1].', citations }, explaining)).toEqual([
      '[1]: an explanation has no time window; drop from and to.',
    ]);
  });

  test('refuses an empty text', () => {
    expect(answerIssues({ text: '  ', citations: [] }, scope)).toEqual(['The text is empty.']);
  });
});
