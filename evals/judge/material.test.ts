import { describe, expect, test } from 'bun:test';
import { allCases } from '../cases/index.ts';
import type { AlertCaseOutcome } from '../checks/alert.ts';
import type { AnswerCaseOutcome } from '../checks/answer.ts';
import type { Outcome } from '../checks/dashboard.ts';
import type { RunAnswerCaseOutcome } from '../checks/run-answer.ts';
import type { EvalCase } from '../core/case.ts';
import { judgeMaterial } from './material.ts';

/**
 * A case by its id.
 *
 * @param id - The id.
 * @returns The case.
 */
function caseOf(id: string): EvalCase {
  return allCases.find((each) => each.id === id) as EvalCase;
}

const query = {
  refId: 'A',
  connector: 'postgres-orders',
  language: 'sql',
  sql: 'SELECT reason, count(*) FROM orders GROUP BY 1',
} as const;

const dashboard: Outcome = {
  id: 'q3',
  built: true,
  panels: [
    {
      id: 'failed',
      title: 'Failed orders by reason',
      connectors: ['postgres-orders'],
      text: 'Failed orders by reason',
      kind: 'table',
      queries: [query],
    },
  ],
  dashboard: { time: { from: 'now-1d/d', to: 'now/d' } },
  results: [
    {
      panelId: 'failed',
      queries: [
        {
          refId: 'A',
          columns: [
            { name: 'reason', type: 'string' },
            { name: 'count', type: 'number', count: 2, sum: 112, min: 12, max: 100 },
          ],
          rowCount: 2,
          rows: [
            ['card_declined', 100],
            ['timeout', 12],
          ],
          truncated: false,
          totals: { card_declined: 100, timeout: 12 },
        },
      ],
    },
  ],
  failing: [],
  repairs: 0,
  asked: [],
  turns: 2,
  usage: { 'claude-sonnet-5': { input: 1, cachedInput: 0, cacheWrite: 0, output: 1 } },
  durationMs: 1,
};

describe('what the judge reads of a dashboard', () => {
  const material = judgeMaterial(caseOf('q3'), dashboard);

  test('what the person asked, each panel with its query, and a summary of what it returned', () => {
    expect(material).toContain('1. How many orders failed yesterday, and for which reasons?');
    expect(material).toContain('Panel “Failed orders by reason” (table)');
    expect(material).toContain('query on postgres-orders (sql): SELECT reason, count(*)');
    expect(material).toContain('returned: 2 rows; columns: reason (string), count (number: min 12');
    expect(material).toContain('totals: {"card_declined":100,"timeout":12}');
  });

  test('the rows only when there are few, and it says when they are not shown', () => {
    expect(material).toContain('rows: [["card_declined",100],["timeout",12]]');
    const [panel] = dashboard.results ?? [];
    const [result] = panel?.queries ?? [];
    const many = { ...result, rowCount: 400, truncated: true } as typeof result;
    const long = { ...dashboard, results: [{ panelId: 'failed', queries: many ? [many] : [] }] };
    expect(judgeMaterial(caseOf('q3'), long)).toContain('rows: not shown');
  });

  test('an empty result says so, and a failed query says why', () => {
    const empty = { refId: 'A', columns: [], rowCount: 0, rows: [], truncated: false };
    const none = { ...dashboard, results: [{ panelId: 'failed', queries: [empty] }] };
    expect(judgeMaterial(caseOf('q3'), none)).toContain('returned: no rows (empty)');
    const failed = { ...empty, error: 'relation "ordrs" does not exist' };
    const broken = { ...dashboard, results: [{ panelId: 'failed', queries: [failed] }] };
    expect(judgeMaterial(caseOf('q3'), broken)).toContain('it failed: relation "ordrs"');
  });

  test('never the model that made it, and a note when it is cut', () => {
    expect(material).not.toContain('claude');
    const sql = `SELECT ${'x, '.repeat(900)} 1`;
    const [panel] = dashboard.panels;
    const wide = { ...dashboard, panels: [{ ...panel, queries: [{ ...query, sql }] }] } as Outcome;
    expect(judgeMaterial(caseOf('q3'), wide)).toContain('[cut]');
  });

  test('says when nothing was built', () => {
    const nothing = { ...dashboard, built: false, panels: [], lastWords: 'I could not.' };
    expect(judgeMaterial(caseOf('q3'), nothing)).toContain('No dashboard was built.');
  });
});

describe('what the judge reads of the other surfaces', () => {
  test('an answer: its text, what it read and what it cites', () => {
    const answer: AnswerCaseOutcome = {
      kind: 'answer',
      id: 'a1',
      ok: true,
      text: 'Errors rose after deploy #481 [1].',
      citations: [{ n: 1, evidenceId: 'e1' }],
      evidence: [
        {
          id: 'e1',
          connector: 'prometheus-dev',
          panelId: 'error-rate-by-service',
          time: { from: '2026-10-03T06:00:00.000Z', to: '2026-10-03T18:00:00.000Z' },
          result: '{"max":0.084}',
        },
      ],
      toolCalls: { read_data: 1 },
      steps: 2,
      usage: {},
      durationMs: 1,
    };
    const material = judgeMaterial(caseOf('a1'), answer);
    expect(material).toContain('The assistant answered: Errors rose after deploy #481 [1].');
    expect(material).toContain('read e1 on prometheus-dev (panel error-rate-by-service)');
    expect(material).toContain('citations: [1] is e1');
  });

  test('an explanation: that the person opened it', () => {
    const none = { kind: 'answer', id: 'a3', ok: false, message: 'refused' } as AnswerCaseOutcome;
    const material = judgeMaterial(caseOf('a3'), { ...none, citations: [], evidence: [] });
    expect(material).toContain('They opened the explanation of error-rate-by-service.');
    expect(material).toContain('No answer was given: refused');
  });

  test('an alert thread: what the person replied, and what the agent said', () => {
    const alert = {
      kind: 'alert',
      id: 'al2',
      said: 'I cannot replay it here.',
    } as AlertCaseOutcome;
    const material = judgeMaterial(caseOf('al2'), alert);
    expect(material).toContain('When asked back, they said: checkout-svc in prod');
    expect(material).toContain('No alert was saved.');
    expect(material).toContain('The assistant said: I cannot replay it here.');
  });

  test('the answers about a run: each question with its answer and its cards', () => {
    const answers = [
      {
        question: 'What stood out yesterday?',
        ok: true,
        text: 'Failed orders jumped.',
        citations: [],
        evidence: [],
        followUps: [{ prompt: 'Alert me on failed orders.' }],
        toolCalls: {},
        steps: 1,
      },
    ];
    const asked = { kind: 'run-answer', id: 'r3', answers, usage: {}, durationMs: 1 };
    const material = judgeMaterial(caseOf('r3'), asked as unknown as RunAnswerCaseOutcome);
    expect(material).toContain('Answer 1, to “What stood out yesterday?”: Failed orders jumped.');
    expect(material).toContain('follow-up card: Alert me on failed orders.');
  });
});
