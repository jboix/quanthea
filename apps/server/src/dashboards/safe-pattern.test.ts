import { describe, expect, test } from 'bun:test';
import { slowPattern } from './safe-pattern.ts';

describe('slowPattern', () => {
  test('passes patterns that match in linear time', () => {
    for (const pattern of [
      '[A-Z]{2}-\\d{4}',
      '\\w+@\\w+\\.com',
      'ord_[0-9a-f]+',
      '(?:prod|staging)-\\d+',
      '(ab)?c',
      '(a){3}',
      '[(+*)]+',
      '\\(a+\\)+',
      '(?<year>\\d{4})-\\d{2}',
      '\\d+-\\d+-\\d+-\\d+',
      '\\d{1,3}(?:\\.\\d{1,3}){3}',
      '[a-z]+(?:-[a-z]+)*',
      '\\w+(?:\\.\\w+)*@\\w+',
      'a?a?a?a?a?aaaaa',
      '(?:prod|staging|dev)-(?:eu|us)-\\d+',
    ])
      expect(slowPattern(pattern)).toBeUndefined();
  });

  test('flags a repeated group that holds a quantifier, an alternation or a back-reference', () => {
    for (const pattern of [
      '(a+)+b',
      '(a*)*',
      '(a?){20}',
      '(a|a)*',
      '(a|aa)+$',
      '((ab)+c)+',
      '(?:\\w+\\s?)*$',
      '([a-z]+-)*x',
      '(a{2,})+',
      '(a)\\1',
      '(?<x>a)\\k<x>',
      '(.*a){12}',
      '(?:-[a-z]+[a-z]+)*',
      '(?:-\\x2d*)*',
      '(?:-[a-z-]+)*',
      '(?:-[a-z]*x?)+',
    ])
      expect(slowPattern(pattern)).toContain('exponential time');
  });

  test('flags quantifiers and alternatives that multiply past four unbounded quantifiers', () => {
    for (const pattern of [
      '\\d*\\d*\\d*\\d*\\d*!',
      '.{1,99}.*.+x?y*',
      `${'(?:a|\\w)'.repeat(12)}.*.*.*.*b`,
      `${'(?:a|a)'.repeat(10)}.*.*.*.*b`,
      'a|b|.*.*.*.*',
    ])
      expect(slowPattern(pattern)).toContain('too many quantifiers');
  });
});
