import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BuiltPanel, Outcome } from '../checks/dashboard.ts';
import type { CaseResult, TrialStatus } from '../core/result.ts';
import { reportOf } from '../core/test/scoring.ts';
import {
  fractionWords,
  headlineOf,
  inBucket,
  noiseFloor,
  readReport,
  rescore,
  writeReport,
} from './report.ts';
import { comparison, headlineLines, summary } from './summary.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const refunds: BuiltPanel = {
  id: 'refunds',
  title: 'Refunds by reason',
  connectors: ['postgres-orders'],
  text: 'Refunds by reason\n[]',
};

/**
 * What a dashboard case made.
 *
 * @param id - The case's id.
 * @param panels - The panels built.
 * @param extra - Fields to change.
 * @returns The evidence.
 */
function made(id: string, panels: readonly BuiltPanel[], extra: Partial<Outcome> = {}): Outcome {
  const built = { id, built: true, panels, failing: [], repairs: 0, asked: [] };
  return { ...built, turns: 2, usage: {}, durationMs: 1000, ...extra };
}

/**
 * A case's results with trials that ended given ways.
 *
 * @param result - Results to copy the first trial of.
 * @param statuses - How each trial ended.
 * @returns The results.
 */
function withTrials(result: CaseResult, statuses: readonly TrialStatus[]): CaseResult {
  const [trial] = result.trials;
  if (!trial) throw new Error('No trial to copy.');
  return { ...result, trials: statuses.map((status, at) => ({ ...trial, trial: at + 1, status })) };
}

describe('reading a report', () => {
  test('one written before trials becomes one trial per case, scored as the cases are now', () => {
    const dir = mkdtempSync(join(tmpdir(), 'quanthea-report-test-'));
    dirs.push(dir);
    const old = {
      startedAt: '2026-10-09T10:00:00.000Z',
      models: { model: 'gemini-3.5-flash-lite' },
      cache: { hits: 0, misses: 4 },
      results: [
        { outcome: made('q9', [refunds]), score: { pass: false, reasons: ['an old reason'] } },
        { outcome: made('q6', []), score: { pass: true, reasons: [] } },
        { outcome: made('gone', []), score: { pass: true, reasons: [] } },
      ],
    };
    const path = join(dir, 'old.json');
    writeFileSync(path, JSON.stringify(old));
    const report = readReport(path);
    expect(report.version).toBe(2);
    expect(report.versions.judge).toBeNull();
    expect(report.results.map((each) => [each.id, each.trials[0]?.status])).toEqual([
      ['q9', 'pass'],
      ['q6', 'fail'],
    ]);
    expect(report.results[0]?.trials[0]?.verdicts[0]?.verdict).toBe('skipped');
  });

  test('one written now reads back as it was written', () => {
    const dir = mkdtempSync(join(tmpdir(), 'quanthea-report-test-'));
    dirs.push(dir);
    const report = reportOf([made('q9', [refunds])]);
    expect(readReport(writeReport(dir, report))).toEqual(JSON.parse(JSON.stringify(report)));
  });

  test('scored again, it keeps the verdicts the judge gave for the sentences that stay', () => {
    const report = reportOf([made('q9', [])]);
    const [result] = report.results;
    const [trial] = result?.trials ?? [];
    expect(trial?.status).toBe('fail');
    const sentence = trial?.verdicts[0]?.sentence ?? '';
    const judged = [{ sentence, verdict: 'yes' as const, reason: 'It does.', evidence: '' }];
    const stale = {
      sentence: 'A sentence since removed.',
      verdict: 'no' as const,
      reason: '',
      evidence: '',
    };
    const kept = { ...result, trials: [{ ...trial, verdicts: [...judged, stale] }] } as CaseResult;
    const again = rescore({ ...report, results: [kept] }).results[0]?.trials[0];
    expect(again?.verdicts).toEqual(judged);
    // The judge read the rubric: the title pattern it replaces no longer decides.
    expect(again?.checks.find((each) => each.id === 'topic:refund')?.outcome).toBe('fail');
    expect(again?.checks.find((each) => each.id === 'queries:postgres-orders')?.outcome).toBe(
      'fail',
    );
  });
});

describe('the headline numbers', () => {
  const [passing] = reportOf([made('q9', [refunds])]).results as [CaseResult];
  const [capable] = reportOf([made('f19', [], { built: false })]).results as [CaseResult];
  const results = [
    passing,
    withTrials({ ...passing, id: 'q3' }, ['pass', 'fail', 'pass']),
    withTrials({ ...passing, id: 'q7' }, ['review']),
    withTrials({ ...passing, id: 'q8' }, ['error']),
    capable,
  ];

  test('count the cases that pass over those that did not err, each bucket apart', () => {
    expect(headlineOf(inBucket(results, 'realistic'))).toEqual({
      pass: 1,
      of: 3,
      review: 1,
      errors: 1,
      unstable: 1,
    });
    expect(headlineOf(inBucket(results, 'capability'))).toMatchObject({ pass: 0, of: 1 });
  });

  test('show a fraction for a case with trials, and say when its trials disagree', () => {
    expect(fractionWords(passing)).toBe('');
    expect(fractionWords(withTrials(passing, ['pass', 'fail', 'pass']))).toBe('2/3, unstable');
    expect(fractionWords(withTrials(passing, ['pass', 'pass']))).toBe('2/2');
  });

  test('say how far a count moves by itself, so a reader tells a change from noise', () => {
    expect(noiseFloor({ pass: 42, of: 60, review: 0, errors: 0, unstable: 0 })).toBe(8);
    expect(noiseFloor({ pass: 10, of: 10, review: 0, errors: 0, unstable: 0 })).toBe(0);
    expect(noiseFloor({ pass: 0, of: 0, review: 0, errors: 0, unstable: 0 })).toBe(0);
  });

  test('read as lines: each bucket, the noise, what stands apart, the score as before, the judge', () => {
    const report = { ...reportOf([]), results, knownUnstable: ['q11 (3/5 on 2026-10-12)'] };
    expect(headlineLines(report)).toEqual([
      'Capability: 0 of 1 pass',
      'Realistic: 1 of 3 pass, 1 for review',
      'Noise: on the same code, the realistic count moves by about 2 between runs.',
      'Unstable in this run: q3 (2/3)',
      'Errors, in no count: q8',
      'Unstable in earlier trials: q11 (3/5 on 2026-10-12)',
      'As scored before rubrics and results: 4 of 5 pass',
      'No judge read the rubrics: the patterns that stand in for them decided.',
    ]);
    const judged = {
      ...report,
      versions: { ...report.versions, judge: 'anthropic/claude-haiku-4-5' },
    };
    const read = { ...judged, judged: { hits: 3, misses: 12, tokens: 8431 } };
    expect(headlineLines(read).at(-1)).toBe(
      'The rubrics were read by anthropic/claude-haiku-4-5: 12 asked for 8,431 tokens, 3 from its cache.',
    );
    expect(summary(report)).toContain('q3    FAIL 2/3, unstable');
  });
});

describe('two reports side by side', () => {
  const before = reportOf([made('q9', [refunds]), made('q6', []), made('q3', [])]);
  const after = reportOf([made('q9', []), made('q6', []), made('q3', [refunds])]);

  test('mark the cases whose status changed, and no other', () => {
    const lines = comparison(before, after).split('\n');
    expect(lines.find((line) => line.startsWith('q9'))).toContain('pass -> FAIL');
    expect(lines.find((line) => line.startsWith('q9'))).toContain('<- changed');
    expect(lines.find((line) => line.startsWith('q6'))).not.toContain('changed');
    expect(lines.at(-1)).toContain('pass 1 -> 0');
  });

  test('do not mark a case earlier trials showed unstable: its change may be noise', () => {
    const known = { ...after, knownUnstable: ['q9 (3/5 on 2026-10-12)'] };
    const line = comparison(before, known)
      .split('\n')
      .find((each) => each.startsWith('q9'));
    expect(line).toContain('(unstable)');
    expect(line).not.toContain('changed');
  });
});
