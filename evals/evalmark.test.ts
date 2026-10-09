import { describe, expect, test } from 'bun:test';
import { checkId, evalmarkResult } from './evalmark.ts';
import type { Report } from './report.ts';
import type { Outcome } from './score.ts';

/**
 * A dashboard question's outcome.
 *
 * @param id - The question's id.
 * @param extra - Fields to change.
 * @returns The outcome.
 */
function outcome(id: string, extra: Partial<Outcome> = {}): Outcome {
  return {
    id,
    built: true,
    panels: [],
    failing: [],
    repairs: 0,
    asked: ['Which service?'],
    turns: 2,
    usage: { 'gemini-3.8-flash': { input: 100, cachedInput: 20, cacheWrite: 0, output: 30 } },
    durationMs: 1200,
    lastWords: 'The dashboard is ready.',
    ...extra,
  };
}

const report: Report = {
  startedAt: '2026-10-09T10:00:00.000Z',
  models: { provider: 'anthropic', model: 'claude-haiku-4-5', build: 'claude-sonnet-5' },
  cache: { hits: 0, misses: 2 },
  results: [
    { outcome: outcome('q1'), score: { pass: true, reasons: [] } },
    {
      outcome: outcome('q2'),
      score: { pass: false, reasons: ['failure-rate runs the same query as total-orders'] },
    },
    {
      outcome: outcome('q3', { error: 'Service Unavailable' }),
      score: { pass: false, reasons: ['the run failed: Service Unavailable'] },
    },
  ],
};

describe('evalmarkResult', () => {
  const result = evalmarkResult(report);

  test('labels the run with its provider and models', () => {
    expect(result.labels).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      'talk-model': 'claude-haiku-4-5',
    });
    expect(result.version).toBe(1);
  });

  test('makes each question a case with one trial', () => {
    expect(result.cases.map((each) => [each.id, each.trials[0]?.status])).toEqual([
      ['q1', 'pass'],
      ['q2', 'fail'],
      ['q3', 'error'],
    ]);
    expect(result.cases[0]?.tags).toEqual(['dashboard']);
    expect(result.cases[0]?.input).toBeTruthy();
  });

  test('keeps the failed expectations, the usage and a short transcript', () => {
    const trial = result.cases[1]?.trials[0];
    expect(trial?.checks).toEqual([
      {
        id: 'failure-rate-runs-the-same-query',
        pass: false,
        message: 'failure-rate runs the same query as total-orders',
      },
    ]);
    expect(trial?.usage?.inputTokens).toBe(120);
    expect(trial?.usage?.outputTokens).toBe(30);
    expect(trial?.transcript?.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'assistant',
    ]);
    expect(trial?.output).toBe('The dashboard is ready.');
  });
});

describe('checkId', () => {
  test('names a check after its first words', () => {
    expect(checkId('No dashboard was built')).toBe('no-dashboard-was-built');
    expect(checkId('!!!')).toBe('check');
  });
});
