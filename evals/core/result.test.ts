import { describe, expect, test } from 'bun:test';
import {
  type CaseResult,
  caseStatus,
  countedTrials,
  fractionOf,
  isUnstable,
  reasonsOf,
  type TrialResult,
  type TrialStatus,
} from './result.ts';

/**
 * A trial that ended a given way.
 *
 * @param status - How it ended.
 * @param legacyStatus - How it would have ended before; the same when left out.
 * @returns The trial.
 */
function trial(status: TrialStatus, legacyStatus: TrialStatus = status): TrialResult {
  const evidence = { id: 'q1', built: true, panels: [], failing: [], repairs: 0, asked: [] };
  return {
    trial: 1,
    status,
    legacyStatus,
    checks: [],
    verdicts: [],
    evidence: { ...evidence, turns: 1, usage: {}, durationMs: 1 },
    truth: {},
    trace: { toolCalls: [], cache: { hits: 0, misses: 0 }, retries: 0 },
  };
}

/**
 * A case with trials that ended given ways.
 *
 * @param statuses - How each trial ended.
 * @returns The case's results.
 */
function ran(...statuses: TrialStatus[]): CaseResult {
  return {
    id: 'q1',
    bucket: 'realistic',
    surface: 'dashboard',
    trials: statuses.map((s) => trial(s)),
  };
}

describe('a case over its trials', () => {
  test('counts its passes over the trials that did not err', () => {
    expect(fractionOf(ran('pass', 'fail', 'error', 'pass'))).toEqual({ pass: 2, of: 3 });
    expect(countedTrials(ran('pass', 'error'))).toHaveLength(1);
    expect(fractionOf(ran('error', 'error'))).toEqual({ pass: 0, of: 0 });
  });

  test('passes when every counted trial passes, and an error is in no count', () => {
    expect(caseStatus(ran('pass', 'pass'))).toBe('pass');
    expect(caseStatus(ran('pass', 'error'))).toBe('pass');
    expect(caseStatus(ran('error'))).toBe('error');
  });

  test('fails when a trial fails, and waits for review when none fails and one is unsure', () => {
    expect(caseStatus(ran('pass', 'fail'))).toBe('fail');
    expect(caseStatus(ran('pass', 'review'))).toBe('review');
    expect(caseStatus(ran('fail', 'review'))).toBe('fail');
  });

  test('is unstable when its trials disagree, never with one trial', () => {
    expect(isUnstable(ran('pass', 'fail', 'pass'))).toBe(true);
    expect(isUnstable(ran('fail', 'fail'))).toBe(false);
    expect(isUnstable(ran('pass'))).toBe(false);
    expect(isUnstable(ran('pass', 'error'))).toBe(false);
  });

  test('has a status as before rubrics and results, read from each trial', () => {
    const result = { ...ran(), trials: [trial('pass', 'fail'), trial('pass', 'pass')] };
    expect(caseStatus(result)).toBe('pass');
    expect(caseStatus(result, true)).toBe('fail');
    expect(fractionOf(result, true)).toEqual({ pass: 1, of: 2 });
  });
});

describe('why a trial did not pass', () => {
  test('gives the faults of the failed checks, then the sentences refused or unsure', () => {
    const failed: TrialResult = {
      ...trial('fail'),
      checks: [
        { id: 'a', kind: 'structure', outcome: 'pass', message: '', faults: [] },
        { id: 'b', kind: 'result', outcome: 'fail', message: 'x; y', faults: ['x', 'y'] },
        { id: 'c', kind: 'legacy', outcome: 'skipped', message: '', faults: [] },
      ],
      verdicts: [
        { sentence: 'It shows errors.', verdict: 'yes', reason: 'It does.', evidence: '' },
        { sentence: 'It shows latency.', verdict: 'no', reason: 'No such panel.', evidence: '' },
        { sentence: 'It keeps to prod.', verdict: 'uncertain', reason: 'No filter.', evidence: '' },
      ],
    };
    expect(reasonsOf(failed)).toEqual([
      'x',
      'y',
      'not: It shows latency. (No such panel.)',
      'unsure whether: It keeps to prod. (No filter.)',
    ]);
    expect(reasonsOf(trial('pass'))).toEqual([]);
  });
});
