import { describe, expect, test } from 'bun:test';
import type { Check } from './case.ts';
import type { Verdict } from './result.ts';
import { decidingChecks, legacyStatusOf, runChecks, statusOf, worthJudging } from './score.ts';

/** What the checks of these tests read. */
interface Made {
  readonly built: boolean;
  readonly title: string;
  readonly value: number;
}

const built: Check<Made> = {
  id: 'built',
  kind: 'structure',
  gate: true,
  faults: (made) => (made.built ? [] : ['nothing was built']),
};
const titled: Check<Made> = {
  id: 'title',
  kind: 'legacy',
  standsInFor: 'rubric',
  faults: (made) => (/error/.test(made.title) ? [] : ['no title about error']),
};
const written: Check<Made> = {
  id: 'written',
  kind: 'legacy',
  standsInFor: 'result',
  faults: () => ['the query is not written as expected'],
};
const right: Check<Made> = {
  id: 'right',
  kind: 'result',
  added: true,
  truths: [{ key: 'count', compute: async () => 3 }],
  faults: (made, { truth }) =>
    made.value === truth.count ? [] : [`${made.value}, not ${truth.count}`],
};

const good: Made = { built: true, title: 'Checkout errors', value: 3 };
const truth = { count: 3 };

/**
 * A verdict on one sentence.
 *
 * @param verdict - What the judge said.
 * @returns The verdict.
 */
function said(verdict: Verdict['verdict']): Verdict {
  return { sentence: 'A panel shows the errors.', verdict, reason: 'because', evidence: '' };
}

describe('running the checks of a case', () => {
  test('runs each in order and keeps what does not hold', () => {
    const outcomes = runChecks([built, titled, right], { ...good, value: 4 }, { truth });
    expect(outcomes.map((each) => [each.id, each.outcome, each.message])).toEqual([
      ['built', 'pass', ''],
      ['title', 'pass', ''],
      ['right', 'fail', '4, not 3'],
    ]);
  });

  test('skips what comes after a gate that failed: one failure, one reason', () => {
    const outcomes = runChecks([built, titled, right], { ...good, built: false }, { truth });
    expect(outcomes.map((each) => each.outcome)).toEqual(['fail', 'skipped', 'skipped']);
    expect(outcomes.flatMap((each) => each.faults)).toEqual(['nothing was built']);
  });

  test('goes on after a check that is no gate', () => {
    const outcomes = runChecks([titled, right], { ...good, title: 'Latency', value: 9 }, { truth });
    expect(outcomes.map((each) => each.outcome)).toEqual(['fail', 'fail']);
  });

  test('skips a check whose truth was never recorded, as in a report written before it', () => {
    expect(runChecks([right], good, { truth: {} })[0]?.outcome).toBe('skipped');
    expect(runChecks([right], good, { truth: { count: null } })[0]?.outcome).toBe('fail');
  });
});

describe('the status of a trial', () => {
  test('is an error when the run failed, whatever the checks say', () => {
    const checks = runChecks([built], { ...good, built: false }, { truth });
    expect(statusOf('503', checks, [])).toBe('error');
    expect(legacyStatusOf('503', checks)).toBe('error');
  });

  test('is a pass when every check passes and every sentence is yes', () => {
    const checks = runChecks([built, titled], good, { truth });
    expect(statusOf(undefined, checks, [said('yes')])).toBe('pass');
  });

  test('is a failure when the judge says no, and a review when it is unsure', () => {
    const checks = runChecks([built], good, { truth });
    expect(statusOf(undefined, checks, [said('yes'), said('no')])).toBe('fail');
    expect(statusOf(undefined, checks, [said('yes'), said('uncertain')])).toBe('review');
    expect(statusOf(undefined, checks, [said('no'), said('uncertain')])).toBe('fail');
  });

  test('a failed check is a failure even when the judge is unsure', () => {
    const checks = runChecks([built, right], { ...good, value: 1 }, { truth });
    expect(statusOf(undefined, checks, [said('uncertain')])).toBe('fail');
  });
});

describe('a legacy check stands in for a rubric or a result', () => {
  const offTopic = { ...good, title: 'Latency' };

  test('it decides while no judge read the rubric', () => {
    const checks = runChecks([built, titled], offTopic, { truth });
    expect(statusOf(undefined, checks, [said('skipped')])).toBe('fail');
    expect(statusOf(undefined, checks, [])).toBe('fail');
  });

  test('it no longer decides once the judge read the rubric', () => {
    const checks = runChecks([built, titled], offTopic, { truth });
    expect(statusOf(undefined, checks, [said('yes')])).toBe('pass');
    expect(decidingChecks(checks, [said('yes')]).map((each) => each.id)).toEqual(['built']);
  });

  test('a pattern over a query no longer decides once a result check ran', () => {
    expect(statusOf(undefined, runChecks([built, written], good, { truth }), [])).toBe('fail');
    const checks = runChecks([built, written, right], good, { truth });
    expect(statusOf(undefined, checks, [])).toBe('pass');
    // The result check had no truth to compare with: the pattern still decides.
    const unrecorded = runChecks([built, written, right], good, { truth: {} });
    expect(statusOf(undefined, unrecorded, [])).toBe('fail');
  });

  test('the status as before counts every old check and no new one, and no verdict', () => {
    const checks = runChecks([built, titled, right], { ...offTopic, value: 9 }, { truth });
    expect(legacyStatusOf(undefined, checks)).toBe('fail');
    const onlyNew = runChecks([built, right], { ...good, value: 9 }, { truth });
    expect(legacyStatusOf(undefined, onlyNew)).toBe('pass');
    expect(statusOf(undefined, onlyNew, [])).toBe('fail');
  });
});

describe('whether the judge reads a rubric', () => {
  test('not after an error, and not after a check that would still count', () => {
    const fine = runChecks([built, titled], good, { truth });
    expect(worthJudging(undefined, fine)).toBe(true);
    expect(worthJudging('503', fine)).toBe(false);
    const wrong = runChecks([built, right], { ...good, value: 9 }, { truth });
    expect(worthJudging(undefined, wrong)).toBe(false);
  });

  test('it does after a pattern the rubric replaces failed: that is what the judge is for', () => {
    const offTopic = runChecks([built, titled], { ...good, title: 'Latency' }, { truth });
    expect(worthJudging(undefined, offTopic)).toBe(true);
  });
});
