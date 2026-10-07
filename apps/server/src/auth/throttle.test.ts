import { describe, expect, test } from 'bun:test';
import { createThrottle } from './throttle.ts';

const rule = { freeFailures: 3, firstWaitMs: 1000, longestWaitMs: 4000, forgetAfterMs: 60_000 };

describe('the throttle', () => {
  test('lets the free failures through, then doubles the wait up to its cap', () => {
    let clock = 0;
    const throttle = createThrottle(rule, () => clock);
    for (let failure = 0; failure < 3; failure += 1) throttle.fail('a');
    expect(throttle.waitFor('a')).toBe(0);
    const waits = [1000, 2000, 4000, 4000].map(() => {
      throttle.fail('a');
      return throttle.waitFor('a');
    });
    expect(waits).toEqual([1000, 2000, 4000, 4000]);
    expect(throttle.waitFor('b')).toBe(0);
    clock += 4000;
    expect(throttle.waitFor('a')).toBe(0);
  });

  test('forgets a key after a success, or after a long quiet', () => {
    let clock = 0;
    const throttle = createThrottle(rule, () => clock);
    for (let failure = 0; failure < 4; failure += 1) throttle.fail('a');
    throttle.forget('a');
    expect(throttle.waitFor('a')).toBe(0);
    for (let failure = 0; failure < 3; failure += 1) throttle.fail('b');
    clock += 60_001;
    throttle.fail('b');
    expect(throttle.waitFor('b')).toBe(0);
  });

  test('undoes one failure, and its wait, after a success', () => {
    const throttle = createThrottle(rule, () => 0);
    for (let failure = 0; failure < 4; failure += 1) throttle.fail('a');
    expect(throttle.waitFor('a')).toBe(1000);
    throttle.undo('a');
    expect(throttle.waitFor('a')).toBe(0);
    throttle.fail('a');
    expect(throttle.waitFor('a')).toBe(1000);
    throttle.undo('b');
    expect(throttle.waitFor('b')).toBe(0);
  });

  test('keeps a waiting key when a flood of other keys fills it', () => {
    const throttle = createThrottle(rule, () => 0);
    for (let failure = 0; failure < 4; failure += 1) throttle.fail('victim');
    for (let other = 0; other < 50_001; other += 1) throttle.fail(`other-${other}`);
    expect(throttle.waitFor('victim')).toBe(1000);
  });
});
