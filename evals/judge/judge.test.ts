import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dashboardCases } from '../cases/dashboards.ts';
import type { Outcome } from '../checks/dashboard.ts';
import type { EvalCase } from '../core/case.ts';
import { type AskJudge, createJudge, readVerdicts } from './judge.ts';
import { jsonIn } from './live.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A folder for a judge's verdicts, removed after the test.
 *
 * @returns The folder.
 */
function verdictsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'quanthea-judge-test-'));
  dirs.push(dir);
  return dir;
}

const errorsShown = 'A panel shows the errors.';
const latencyShown = 'A panel shows the latency.';
const rubric = [errorsShown, latencyShown];
const q1 = dashboardCases.find((each) => each.id === 'q1') as EvalCase;
const made: Outcome = {
  id: 'q1',
  built: true,
  panels: [{ id: 'errors', title: 'Errors', connectors: ['prometheus-dev'], text: 'Errors\n[]' }],
  failing: [],
  repairs: 0,
  asked: [],
  turns: 2,
  usage: { 'some-model': { input: 1, cachedInput: 0, cacheWrite: 0, output: 1 } },
  durationMs: 1,
};

/**
 * A judge's model that answers yes to every sentence, and counts its calls.
 *
 * @param calls - Where each question it was asked goes.
 * @returns The model.
 */
function yesModel(calls: string[]): AskJudge {
  return async (_instructions, question) => {
    calls.push(question);
    const verdicts = (q1.rubric ?? []).map((_each, index) => ({
      n: index + 1,
      verdict: 'yes',
      reason: 'It does.',
      evidence: 'Errors',
    }));
    return { answer: { verdicts }, tokens: 100 };
  };
}

describe('reading what the judge answered', () => {
  test('gives one verdict per sentence, in order, with its reason and what it is based on', () => {
    const answered = {
      verdicts: [
        { n: 1, verdict: 'yes', reason: 'The Errors panel does.', evidence: 'Panel “Errors”' },
        { n: 2, verdict: 'no', reason: 'No panel about latency.', evidence: '' },
      ],
    };
    expect(readVerdicts(rubric, answered)).toEqual([
      {
        sentence: errorsShown,
        verdict: 'yes',
        reason: 'The Errors panel does.',
        evidence: 'Panel “Errors”',
      },
      { sentence: latencyShown, verdict: 'no', reason: 'No panel about latency.', evidence: '' },
    ]);
  });

  test('an answer that is missing, or not one of the three, is uncertain: never a pass', () => {
    const short = readVerdicts(rubric, { verdicts: [{ verdict: 'probably' }] });
    expect(short.map((each) => each.verdict)).toEqual(['uncertain', 'uncertain']);
    expect(readVerdicts(rubric, undefined).map((each) => each.verdict)).toEqual([
      'uncertain',
      'uncertain',
    ]);
    expect(short[0]?.reason).toBe('the judge gave no usable answer');
  });

  test('reads the JSON a model wrote inside a fence or a sentence', () => {
    expect(jsonIn('```json\n{"verdicts":[]}\n```')).toEqual({ verdicts: [] });
    expect(jsonIn('Here: {"a":1}.')).toEqual({ a: 1 });
    expect(jsonIn('no object')).toBeUndefined();
    expect(jsonIn('{broken')).toBeUndefined();
  });
});

describe('the judge', () => {
  test('answers each sentence of a case, and never asks twice for the same thing', async () => {
    const calls: string[] = [];
    const options = { label: 'test/judge', ask: yesModel(calls), dir: verdictsDir(), budget: 9 };
    const judge = createJudge(options);
    const first = await judge.read(q1, made);
    expect(first.map((each) => each.verdict)).toEqual(['yes', 'yes']);
    expect(first.map((each) => each.sentence)).toEqual([...(q1.rubric ?? [])]);
    expect(await judge.read(q1, made)).toEqual(first);
    expect(calls).toHaveLength(1);
    expect(judge.counts).toEqual({ hits: 1, misses: 1, tokens: 100 });
    // Another judge on the same folder finds the verdicts of the first.
    const again = createJudge(options);
    await again.read(q1, made);
    expect(again.counts).toEqual({ hits: 1, misses: 0, tokens: 0 });
  });

  test('is asked again when what it reads changes: the thing made, the sentence, or the judge', async () => {
    const calls: string[] = [];
    const dir = verdictsDir();
    const options = { label: 'test/judge', ask: yesModel(calls), dir, budget: 9 };
    const judge = createJudge(options);
    await judge.read(q1, made);
    await judge.read(q1, { ...made, panels: [] });
    await judge.read({ ...q1, rubric: ['Another sentence.'] } as EvalCase, made);
    await createJudge({ ...options, label: 'test/other-judge' }).read(q1, made);
    await createJudge({ ...options, draw: 2 }).read(q1, made);
    expect(calls).toHaveLength(5);
  });

  test('is never told which provider or model made what it reads', async () => {
    const calls: string[] = [];
    const judge = createJudge({ label: 'j', ask: yesModel(calls), dir: verdictsDir(), budget: 9 });
    await judge.read(q1, made);
    expect(calls[0]).not.toContain('some-model');
    expect(calls[0]).toContain('Panel “Errors”');
    expect(calls[0]).toContain(`1. ${q1.rubric?.[0]}`);
  });

  test('leaves a rubric unjudged once its budget is spent, and when its model fails', async () => {
    const calls: string[] = [];
    const spent = createJudge({ label: 'j', ask: yesModel(calls), dir: verdictsDir(), budget: 1 });
    await spent.read(q1, made);
    const past = await spent.read(q1, { ...made, panels: [] });
    expect(past.map((each) => each.verdict)).toEqual(['skipped', 'skipped']);
    expect(past[0]?.reason).toBe('the judge’s budget is spent');
    const failing: AskJudge = () => Promise.reject(new Error('overloaded'));
    const down = createJudge({ label: 'j', ask: failing, dir: verdictsDir(), budget: 9 });
    const none = await down.read(q1, made);
    expect(none.map((each) => each.verdict)).toEqual(['skipped', 'skipped']);
    expect(none[0]?.reason).toBe('the judge failed: overloaded');
    // A failure is not kept: the next read asks again.
    expect(down.counts.hits).toBe(0);
  });
});
