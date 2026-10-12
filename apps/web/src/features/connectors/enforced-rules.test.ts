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

  test('lists nothing for a language it does not know, or none', () => {
    expect(enforcedRules('cypher')).toEqual([]);
    expect(enforcedRules(undefined)).toEqual([]);
  });
});
