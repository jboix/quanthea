import { describe, expect, test } from 'bun:test';
import type { Expectation } from './questions.ts';
import { type Outcome, score } from './score.ts';

const expectation: Expectation = {
  connectors: ['prometheus-dev', 'postgres-orders'],
  panels: [2, 4],
  topics: [/error/i, /deploy/i],
  maxRepairs: 1,
};

const outcome: Outcome = {
  id: 'q5',
  built: true,
  panels: [
    {
      id: 'errors',
      title: 'Error rate',
      connectors: ['prometheus-dev'],
      text: 'Error rate rate(...)',
    },
    {
      id: 'deploys',
      title: 'Deploys',
      connectors: ['postgres-orders'],
      text: 'Deploys SELECT ...',
    },
  ],
  failing: [],
  repairs: 0,
  asked: ['Which service?'],
  turns: 3,
  usage: {},
  durationMs: 1000,
};

describe('scoring an answer', () => {
  test('passes when every expectation holds', () => {
    expect(score(outcome, expectation)).toEqual({ pass: true, reasons: [] });
  });

  test('says each thing that does not hold', () => {
    const poor: Outcome = {
      ...outcome,
      panels: [outcome.panels[0] as Outcome['panels'][number]],
      failing: [{ panelId: 'errors', error: 'unknown label "region"' }],
      repairs: 3,
    };
    expect(score(poor, expectation).reasons).toEqual([
      '1 panels, expected 2 to 4',
      'errors fails: unknown label "region"',
      '3 failed writes, at most 1',
      'no panel about deploy',
      'never queries postgres-orders',
    ]);
  });

  test('fails a query on a fixed time, and two panels running the same query', () => {
    const sql = (text: string) =>
      JSON.stringify([{ refId: 'A', connector: 'postgres-orders', language: 'sql', sql: text }]);
    const panel = (id: string, text: string) => ({
      id,
      title: id,
      connectors: ['postgres-orders', 'prometheus-dev'],
      text: `${id}\n${sql(text)}`,
    });
    const fixed: Outcome = {
      ...outcome,
      panels: [
        panel('deploys', "SELECT 1 FROM deploys WHERE deployed_at >= NOW() - INTERVAL '2 days'"),
        panel('errors', 'SELECT 1 FROM errors WHERE at BETWEEN :__from AND :__to'),
        panel('errors-again', 'SELECT 1 FROM errors WHERE at BETWEEN :__from AND :__to'),
      ],
    };
    expect(score(fixed, expectation).reasons).toEqual([
      'deploys: the query reads the current time',
      'errors-again runs the same query as errors',
    ]);
  });

  test('fails a run with no dashboard, or one that broke, before anything else', () => {
    expect(score({ ...outcome, built: false }, expectation).reasons).toEqual([
      'no dashboard was built',
    ]);
    expect(score({ ...outcome, error: '429 quota' }, expectation).reasons).toEqual([
      'the run failed: 429 quota',
    ]);
  });
});
