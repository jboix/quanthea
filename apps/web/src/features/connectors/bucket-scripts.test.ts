import { describe, expect, test } from 'bun:test';
import { queryLanguages } from '@quanthea/shared';
import { bucketScriptsEffect, bucketScriptsPatch, offersBucketScripts } from './bucket-scripts.ts';

describe('the bucket scripts setting', () => {
  test('is offered on a search connector and no other', () => {
    const offered = queryLanguages.filter((language) => offersBucketScripts(language));
    expect(offered).toEqual(['search']);
    expect(offersBucketScripts(undefined)).toBe(false);
  });

  test('sends a change only when the switch moved', () => {
    expect(bucketScriptsPatch(false, false)).toBeUndefined();
    expect(bucketScriptsPatch(true, true)).toBeUndefined();
    expect(bucketScriptsPatch(false, true)).toEqual({ bucketScripts: true });
    expect(bucketScriptsPatch(true, false)).toEqual({ bucketScripts: false });
  });

  test('says what a query may run, on and off', () => {
    expect(bucketScriptsEffect(false)).toContain('the two fixed ratio scripts and no other');
    expect(bucketScriptsEffect(true)).toContain('one arithmetic expression of its own');
    expect(bucketScriptsEffect(true)).toContain('the numbers of the buckets it names');
  });
});
