import { describe, expect, test } from 'bun:test';
import type { Outcome } from '../checks/dashboard.ts';
import type { CaseResult, TrialResult } from '../core/result.ts';
import { evalmarkResult } from './evalmark.ts';
import type { Report } from './report.ts';

/**
 * A dashboard case's evidence.
 *
 * @param id - The case's id.
 * @param extra - Fields to change.
 * @returns The evidence.
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

/**
 * A trial of a dashboard case.
 *
 * @param id - The case's id.
 * @param extra - Fields to change.
 * @returns The trial.
 */
function trial(id: string, extra: Partial<TrialResult> = {}): TrialResult {
  const call = { tool: 'edit_dashboard', input: '{"panels":[]}', output: '{"ok":true}' };
  return {
    trial: 1,
    status: 'pass',
    legacyStatus: 'pass',
    checks: [{ id: 'built', kind: 'structure', outcome: 'pass', message: '', faults: [] }],
    verdicts: [],
    evidence: outcome(id),
    truth: {},
    trace: { toolCalls: [call], cache: { hits: 0, misses: 2 }, retries: 0 },
    ...extra,
  };
}

/**
 * A dashboard case's results.
 *
 * @param id - The case's id.
 * @param trials - Its trials.
 * @returns The results.
 */
function ran(id: string, trials: TrialResult[]): CaseResult {
  return { id, bucket: 'realistic', surface: 'dashboard', trials };
}

const duplicate = 'failure-rate runs the same query as total-orders';
const failed = trial('q2', {
  status: 'fail',
  checks: [
    { id: 'built', kind: 'structure', outcome: 'pass', message: '', faults: [] },
    {
      id: 'no-duplicate-queries',
      kind: 'structure',
      outcome: 'fail',
      message: duplicate,
      faults: [duplicate],
    },
    { id: 'topic:error', kind: 'legacy', outcome: 'skipped', message: '', faults: [] },
  ],
});
const sentence = 'A panel shows how many orders failed.';
const unsure = trial('q3', {
  status: 'review',
  verdicts: [
    { sentence, verdict: 'uncertain', reason: 'The result is empty.', evidence: '0 rows' },
    { sentence: 'Another.', verdict: 'skipped', reason: 'the run had no judge', evidence: '' },
  ],
});
const erred = trial('q4', {
  status: 'error',
  evidence: outcome('q4', { error: 'Service Unavailable' }),
});

const report: Report = {
  version: 2,
  startedAt: '2026-10-09T10:00:00.000Z',
  models: { provider: 'anthropic', model: 'claude-haiku-4-5', build: 'claude-sonnet-5' },
  versions: { judge: 'anthropic/claude-haiku-4-5', judgePrompt: 1, data: '2026-10-09', sample: '' },
  cache: { hits: 0, misses: 2 },
  judged: { hits: 0, misses: 1 },
  results: [
    ran('q1', [trial('q1'), trial('q1', { trial: 2 })]),
    ran('q2', [failed]),
    ran('q3', [unsure]),
    ran('q4', [erred]),
  ],
  skipped: [{ id: 'a5', needs: ['search'] }],
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

  test('makes each case a case with its trials, tagged with its surface and its bucket', () => {
    expect(result.cases.map((each) => [each.id, each.trials.map((one) => one.status)])).toEqual([
      ['q1', ['pass', 'pass']],
      ['q2', ['fail']],
      ['q3', ['skip']],
      ['q4', ['error']],
      ['a5', ['skip']],
    ]);
    expect(result.cases[0]?.tags).toEqual(['dashboard', 'realistic']);
    expect(result.cases[0]?.input).toBeTruthy();
  });

  test('keeps each check that ran, the usage and a transcript with the tool calls', () => {
    const kept = result.cases[1]?.trials[0];
    expect(kept?.checks).toEqual([
      { id: 'built', pass: true },
      { id: 'no-duplicate-queries', pass: false, message: duplicate },
    ]);
    expect(kept?.usage?.inputTokens).toBe(120);
    expect(kept?.usage?.outputTokens).toBe(30);
    expect(kept?.transcript?.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'assistant',
    ]);
    expect(kept?.transcript?.at(-1)?.toolCalls?.map((call) => call.name)).toEqual([
      'edit_dashboard',
    ]);
    expect(kept?.output).toBe('The dashboard is ready.');
  });

  test('keeps a rubric sentence the judge answered as a check, and a review as a skipped trial', () => {
    const kept = result.cases[2]?.trials[0];
    expect(kept?.checks?.at(-1)).toEqual({
      id: `rubric: ${sentence}`,
      pass: false,
      message: 'The result is empty.',
    });
    expect(kept?.checks).toHaveLength(2);
    expect(kept?.error).toBe('for review: the judge was unsure');
  });

  test('says why a trial erred, and what a skipped case lacks', () => {
    expect(result.cases[3]?.trials[0]?.error).toBe('Service Unavailable');
    expect(result.cases[4]?.trials[0]?.output).toBe(
      'a5: skipped, the world has no search connector (run with --search)',
    );
  });
});
