import { describe, expect, test } from 'bun:test';
import type { DashboardQuestion } from '@quanthea/shared';
import { marksOnVersion, panelMarks, questionThreads } from './ask-marks.ts';

const read = {
  id: 'e1',
  connector: 'prometheus',
  panelId: 'errors',
  query: {},
  variables: {},
  time: { from: '2026-09-26T11:30:00Z', to: '2026-09-26T13:00:00Z' },
  result: { ok: true },
};

const answer = {
  evidence: [read],
  citations: [
    { n: 1, evidenceId: 'e1', from: '2026-09-26T12:04:00Z', to: '2026-09-26T12:41:00Z' },
    { n: 2, panelId: 'deploys' },
    { n: 3, panelId: 'errors' },
    { n: 4 },
  ],
};

/**
 * A stored question.
 *
 * @param id - Its id.
 * @param askedAt - When it was asked.
 * @param parentId - The question it follows up on.
 * @returns The question.
 */
function question(id: string, askedAt: number, parentId: string | null = null): DashboardQuestion {
  return {
    id,
    dashboardId: 'd1',
    version: 1,
    parentId,
    time: { from: 0, to: 1 },
    timeZone: 'UTC',
    variables: {},
    hiddenMarkers: [],
    explainOnly: false,
    askedBy: 'Ana',
    askedAt,
    question: id,
    outcome: { ok: false, message: 'No model.', evidence: [] },
    tokens: 0,
  };
}

describe('panel marks', () => {
  test('numbers each cited panel, by the citation or by the read it cites, with its windows', () => {
    expect(panelMarks(answer)).toEqual({
      errors: {
        numbers: [1, 3],
        windows: [
          { n: 1, from: Date.parse('2026-09-26T12:04:00Z'), to: Date.parse('2026-09-26T12:41Z') },
        ],
      },
      deploys: { numbers: [2], windows: [] },
    });
  });

  test('skips a window that runs backwards or does not parse', () => {
    const citations = [
      { n: 1, panelId: 'errors', from: '2026-09-26T13:00:00Z', to: '2026-09-26T12:00:00Z' },
      { n: 2, panelId: 'errors', from: 'soon', to: 'later' },
    ];
    expect(panelMarks({ evidence: [], citations }).errors?.windows).toEqual([]);
  });

  test('marks nothing on another version than the one asked about', () => {
    expect(marksOnVersion({ version: 2, answer }, 3)).toBeUndefined();
    expect(marksOnVersion({ version: 3, answer }, 3)?.deploys?.numbers).toEqual([2]);
    expect(marksOnVersion(undefined, 3)).toBeUndefined();
  });
});

describe('question threads', () => {
  test('lists first questions newest first, their follow-ups under them oldest first', () => {
    const questions = [
      question('b', 20),
      question('a', 10),
      question('a2', 30, 'a'),
      question('a3', 40, 'a2'),
      question('orphan', 50, 'gone'),
    ];
    const threads = questionThreads(questions);
    expect(
      threads.map(({ root, followUps }) => [root.id, followUps.map((each) => each.id)]),
    ).toEqual([
      ['orphan', []],
      ['b', []],
      ['a', ['a2', 'a3']],
    ]);
  });
});
