import { describe, expect, test } from 'bun:test';
import { defaultCases, namedCases } from '../cases/index.ts';
import { parityCases, parityWord } from '../cases/parity.ts';
import type { Outcome } from '../checks/dashboard.ts';
import { summary } from '../report/summary.ts';
import { planCases, selectCases, skippedLine } from './select.ts';
import { reportOf } from './test/scoring.ts';

const catalogue = { defaults: defaultCases, named: namedCases, namedWord: parityWord };

/**
 * The ids of some cases.
 *
 * @param cases - The cases.
 * @returns Their ids, in order.
 */
function ids(cases: readonly { readonly id: string }[]): string[] {
  return cases.map((each) => each.id);
}

describe('the cases a run takes', () => {
  test('are the default cases when --only names none: no parity case', () => {
    expect(selectCases([], catalogue)).toBe(defaultCases);
    expect(defaultCases.some((each) => parityCases.includes(each as never))).toBe(false);
  });

  test('are those --only names by id, in the cases’ order, whatever the order asked', () => {
    expect(ids(selectCases(['r1', 'f05', 'q3', 'a2'], catalogue))).toEqual([
      'q3',
      'a2',
      'r1',
      'f05',
    ]);
  });

  test('are every parity case by their word', () => {
    expect(selectCases([parityWord], catalogue)).toEqual(parityCases);
  });

  test('are the cases of a bucket by its name, the named ones too', () => {
    const realistic = selectCases(['realistic'], catalogue);
    expect(realistic.every((each) => each.bucket === 'realistic')).toBe(true);
    expect(ids(realistic)).toContain('q1');
    expect(ids(selectCases(['capability'], catalogue))).toContain('f01');
  });

  test('refuse a word that names no case', () => {
    expect(() => selectCases(['q1', 'nope'], catalogue)).toThrow('No case nope.');
  });

  test('have ids of their own, one bucket each, and at most three turns', () => {
    const all = [...defaultCases, ...namedCases];
    expect(new Set(ids(all)).size).toBe(all.length);
    expect(all.every((each) => each.input.turns.length <= 3)).toBe(true);
  });
});

describe('skipping the cases the world cannot run', () => {
  test('a case with a need the world lacks is skipped, with what it lacks', () => {
    const plan = planCases(parityCases, ['search']);
    expect(plan.skipped).toEqual([
      { id: 'f23', needs: ['http'] },
      { id: 'f24', needs: ['pinned-target'] },
      { id: 'f25', needs: ['http'] },
    ]);
    expect(plan.ready).toHaveLength(parityCases.length - 3);
  });

  test('it runs once the world has what it needs', () => {
    expect(planCases(parityCases, ['search', 'http']).skipped).toEqual([
      { id: 'f24', needs: ['pinned-target'] },
    ]);
    expect(planCases(parityCases, ['search', 'http', 'pinned-target']).ready).toEqual(parityCases);
  });

  test('without the search connector, the cases about the player events are skipped', () => {
    const plan = planCases(defaultCases, []);
    expect(plan.skipped).toEqual([{ id: 'a5', needs: ['search'] }]);
    expect(planCases(defaultCases, ['search']).skipped).toEqual([]);
  });

  test('a skipped case is reported as skipped, not as a failure', () => {
    expect(skippedLine({ id: 'f23', needs: ['http'] })).toBe(
      'f23: skipped, the world has no http connector',
    );
    const built: Outcome = {
      id: 'q9',
      built: true,
      panels: [],
      failing: [],
      repairs: 0,
      asked: [],
      turns: 2,
      usage: {},
      durationMs: 1000,
    };
    const text = summary(reportOf([built], [{ id: 'f23', needs: ['http'] }]));
    expect(text).toContain('f23: skipped, the world has no http connector');
    expect(text).toContain('Realistic: 0 of 1 pass');
  });
});
