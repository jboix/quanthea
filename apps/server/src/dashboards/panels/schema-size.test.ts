import { describe, expect, test } from 'bun:test';
import { type BuilderLanguage, builderLanguages, queryBuilders } from '@quanthea/shared';
import { z } from 'zod';
import { editRequestSchemaFor } from './request.ts';

/**
 * The most characters the edit tool's JSON schema may have in a thread of one query language, with
 * every builder of that language offered. Providers that constrain tool input refuse a schema that
 * grows too large, so a change that raises a measure past its ceiling is a decision, not a detail:
 * raise a ceiling only with a number the maintainer has checked against the providers.
 */
const ceilings: Record<BuilderLanguage, number> = {
  promql: 15_000,
  sql: 16_000,
  search: 17_500,
  logql: 18_000,
  mongodb: 17_500,
};

/**
 * The edit tool's JSON schema in a thread whose connectors speak one query language: every builder
 * of that language, no saved query, every chart recipe.
 *
 * @param language - The query language.
 * @returns The schema as JSON text.
 */
function editSchemaJson(language: BuilderLanguage): string {
  const builtIn = queryBuilders
    .filter((builder) => builder.language === language)
    .map((builder) => builder.id);
  const schema = editRequestSchemaFor({ builtIn, saved: [] });
  return JSON.stringify(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }));
}

/**
 * What a failed size check says: the measure beside its ceiling.
 *
 * @param language - The query language.
 * @param size - The measured size, in characters.
 * @returns The message.
 */
function sizeMessage(language: BuilderLanguage, size: number): string {
  return `The edit schema for ${language} is ${size} characters, over its ceiling of ${ceilings[language]}.`;
}

describe('the size of the edit schema', () => {
  for (const language of builderLanguages) {
    test(`for ${language} has no reference and stays under its ceiling`, () => {
      const json = editSchemaJson(language);
      expect(json).not.toContain('$ref');
      expect(json).toContain('"raw"');
      expect(json.length <= ceilings[language], sizeMessage(language, json.length)).toBe(true);
    });
  }

  test('offers at least one builder in every language measured', () => {
    for (const language of builderLanguages) {
      expect(queryBuilders.some((builder) => builder.language === language)).toBe(true);
    }
  });
});
