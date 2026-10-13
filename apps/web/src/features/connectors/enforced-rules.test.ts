import { describe, expect, test } from 'bun:test';
import { queryLanguages } from '@quanthea/shared';
import { enforcedRules } from './enforced-rules.ts';

describe('enforcedRules', () => {
  test('lists rules for every query language', () => {
    for (const language of queryLanguages) {
      expect(enforcedRules(language).length).toBeGreaterThan(0);
    }
  });

  test('says each rule once, in one sentence that ends with a period', () => {
    for (const language of queryLanguages) {
      const rules = enforcedRules(language);
      expect(new Set(rules.map((rule) => rule.rule)).size).toBe(rules.length);
      for (const rule of rules) expect(rule.stops).toMatch(/^[^—]+\.$/);
    }
  });

  test('says what a search may run in its bucket aggregations, by the connector setting', () => {
    const names = (bucketScripts: boolean) =>
      enforcedRules('search', { bucketScripts }).map((rule) => rule.rule);
    expect(names(false)).toContain('Ratio scripts only');
    expect(names(true)).toContain('Bucket scripts are one short expression');
    expect(names(true)).not.toContain('Ratio scripts only');
    expect(enforcedRules('search')).toEqual(enforcedRules('search', { bucketScripts: false }));
    for (const bucketScripts of [false, true]) {
      const [first, ...rest] = enforcedRules('search', { bucketScripts });
      expect(first?.rule).toBe('No scripts that read documents');
      expect(first?.stops).toContain('whatever the settings');
      expect(rest).toHaveLength(enforcedRules('search').length - 1);
      for (const rule of rest) expect(rule.stops).toMatch(/^[^—]+\.$/);
    }
    expect(enforcedRules('sql', { bucketScripts: true })).toEqual(enforcedRules('sql'));
  });

  test('lists nothing for a language it does not know, or none', () => {
    expect(enforcedRules('cypher')).toEqual([]);
    expect(enforcedRules(undefined)).toEqual([]);
  });
});
