import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allCases } from '../cases/index.ts';
import type { EvalCase } from './case.ts';
import { type RunSetup, runCase } from './runner.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A run's setup with an empty cache and no key: every model call fails at once.
 *
 * @param trials - How many trials each case gets.
 * @returns The setup.
 */
function keyless(trials: number): RunSetup {
  const dir = mkdtempSync(join(tmpdir(), 'quanthea-runner-test-'));
  dirs.push(dir);
  return {
    models: { provider: 'anthropic', model: 'a-model', build: 'another-model' },
    apiKey: undefined,
    cache: { dir, read: true, minIntervalMs: 0 },
    search: false,
    trials,
    sample: '',
    judge: undefined,
    pacing: { last: 0 },
    counts: { hits: 0, misses: 0 },
  };
}

/**
 * A case by its id.
 *
 * @param id - The id.
 * @returns The case.
 */
function caseOf(id: string): EvalCase {
  return allCases.find((each) => each.id === id) as EvalCase;
}

/**
 * A case whose fixture cannot be built, so no model is ever asked.
 *
 * @param id - The id of the case to copy.
 * @returns The case.
 */
function unbuildable(id: string): EvalCase {
  const given = { id: 'broken', prepare: () => Promise.reject(new Error('no such recording')) };
  return { ...caseOf(id), given } as EvalCase;
}

describe('running a case', () => {
  test('a trial that cannot start ends in an error, after one more try, not in a crash', async () => {
    const setup = keyless(1);
    const result = await runCase(unbuildable('al3'), setup);
    expect(result).toMatchObject({ id: 'al3', bucket: 'capability', surface: 'alert' });
    const [trial] = result.trials;
    expect(trial?.status).toBe('error');
    expect(trial?.legacyStatus).toBe('error');
    expect(trial?.trace.retries).toBe(1);
    expect(trial?.evidence.error).toBe('no such recording');
    expect(trial?.evidence).toMatchObject({ kind: 'alert', versions: 0 });
    expect(setup.counts).toEqual({ hits: 0, misses: 0 });
  });

  test('runs every trial, tells each as it comes, and leaves the judge out of an error', async () => {
    const seen: number[] = [];
    const judged: string[] = [];
    const judge = {
      read: async (evalCase: EvalCase) => {
        judged.push(evalCase.id);
        return [];
      },
    };
    const setup = { ...keyless(3), judge };
    const result = await runCase(unbuildable('q9'), setup, (trial) => seen.push(trial.trial));
    expect(seen).toEqual([1, 2, 3]);
    expect(result.trials.map((trial) => trial.status)).toEqual(['error', 'error', 'error']);
    expect(result.trials[0]?.verdicts.map((each) => each.verdict)).toEqual(['skipped']);
    expect(judged).toEqual([]);
  });

  test('an error has the empty evidence of its surface, so a report can still show it', async () => {
    const kinds: (string | undefined)[] = [];
    for (const id of ['q9', 'a1', 'a3', 'r1', 'r3']) {
      const [trial] = (await runCase(unbuildable(id), keyless(1))).trials;
      kinds.push((trial?.evidence as { kind?: string } | undefined)?.kind);
      expect(trial?.status).toBe('error');
    }
    expect(kinds).toEqual([undefined, 'answer', 'answer', 'report', 'run-answer']);
  });
});
