import { describe, expect, test } from 'bun:test';
import type { CaseResult, TrialStatus } from '../core/result.ts';
import { reportOf } from '../core/test/scoring.ts';
import { knownUnstable, modelsKey, observed, type UnstableBook } from './unstable.ts';

const models = {
  provider: 'anthropic',
  model: 'claude-haiku-4-5',
  build: 'claude-sonnet-5',
} as const;

/**
 * A case's results with trials that ended given ways.
 *
 * @param id - The case's id.
 * @param statuses - How each trial ended.
 * @returns The results.
 */
function ran(id: string, statuses: readonly TrialStatus[]): CaseResult {
  const made = { id, built: true, panels: [], failing: [], repairs: 0, asked: [] };
  const [result] = reportOf([{ ...made, id: 'q9', turns: 1, usage: {}, durationMs: 1 }]).results;
  const [trial] = result?.trials ?? [];
  if (!result || !trial) throw new Error('No trial to copy.');
  const trials = statuses.map((status) => ({ ...trial, status }));
  return { ...result, id, trials };
}

describe('the book of cases seen unstable', () => {
  const results = [
    ran('q3', ['pass', 'fail', 'pass', 'pass', 'fail']),
    ran('q7', ['pass', 'pass', 'pass']),
    ran('q9', ['pass']),
    ran('q11', ['fail', 'error']),
  ];
  const book = observed({}, models, results, '2026-10-14');

  test('keeps the fraction and the day of each case that had two counted trials or more', () => {
    expect(book[modelsKey(models)]).toEqual({
      q3: { pass: 3, of: 5, date: '2026-10-14' },
      q7: { pass: 3, of: 3, date: '2026-10-14' },
    });
  });

  test('names the cases whose trials disagreed, for these models only', () => {
    expect(knownUnstable(book, models)).toEqual(['q3 (3/5 on 2026-10-14)']);
    expect(knownUnstable(book, { provider: 'google', model: 'gemini-3.5-flash-lite' })).toEqual([]);
  });

  test('the maintainer’s word stands over the fraction, and survives the next run', () => {
    const settled: UnstableBook = {
      [modelsKey(models)]: {
        q3: { pass: 3, of: 5, date: '2026-10-14', stable: true },
        q7: { pass: 3, of: 3, date: '2026-10-14', stable: false },
      },
    };
    expect(knownUnstable(settled, models)).toEqual(['q7 (3/3 on 2026-10-14)']);
    const later = observed(settled, models, [ran('q3', ['fail', 'pass'])], '2026-10-20');
    expect(later[modelsKey(models)]?.q3).toEqual({
      pass: 1,
      of: 2,
      date: '2026-10-20',
      stable: true,
    });
    expect(later[modelsKey(models)]?.q7?.stable).toBe(false);
  });
});
