import { describe, expect, test } from 'bun:test';
import { type BuilderLanguage, builderLanguages, queryBuilders } from '@quanthea/shared';
import { editRequestSchemaFor } from '../dashboards/panels/index.ts';
import { providerSchema } from './tool-schema.ts';

/**
 * The most characters the edit tool's schema may have as a provider receives it, in a run whose
 * connectors speak one query language, with every builder of that language offered. Gemini took a
 * forced call of the tool at about 19,000 characters as sent and refused it at about 26,000, so
 * each ceiling sits a few hundred characters above its measure: a change that passes one is a
 * decision, not a detail. Raise a ceiling only with a number the maintainer has checked against
 * the providers.
 */
const ceilings: Record<BuilderLanguage, number> = {
  promql: 9_200,
  sql: 9_800,
  search: 10_800,
  logql: 11_100,
  mongodb: 10_900,
};

/** The ceiling of a run on a metrics source and a SQL source, the usual pair. */
const pairCeiling = 12_800;

/** The ceiling of a run on metrics, SQL and search together: what Gemini is known to accept. */
const threeCeiling = 19_000;

/**
 * The edit tool's schema as a provider receives it, in a run about some query languages: every
 * builder of those languages, no saved query, every chart recipe.
 *
 * @param languages - The languages of the connectors in use.
 * @returns The schema as JSON text.
 */
async function sentFor(languages: readonly BuilderLanguage[]): Promise<string> {
  const builtIn = queryBuilders
    .filter((builder) => languages.includes(builder.language))
    .map((builder) => builder.id);
  const schema = providerSchema(editRequestSchemaFor({ builtIn, saved: [] }), languages);
  return JSON.stringify(await schema.jsonSchema);
}

/**
 * Checks a measure against its ceiling, saying both when it is over.
 *
 * @param languages - The languages measured.
 * @param ceiling - The most characters allowed.
 */
async function expectUnder(languages: readonly BuilderLanguage[], ceiling: number): Promise<void> {
  const size = (await sentFor(languages)).length;
  const message = `The edit schema as sent for ${languages.join('+')} is ${size} characters, over its ceiling of ${ceiling}.`;
  expect(size <= ceiling, message).toBe(true);
}

describe('the size of the edit schema as providers receive it', () => {
  for (const language of builderLanguages) {
    test(`for ${language} has no reference and stays under its ceiling`, async () => {
      const json = await sentFor([language]);
      expect(json).not.toContain('$ref');
      expect(json).toContain('"raw"');
      await expectUnder([language], ceilings[language]);
    });
  }

  test('stays under its ceiling for metrics with SQL, and for both with search', async () => {
    await expectUnder(['promql', 'sql'], pairCeiling);
    await expectUnder(['promql', 'sql', 'search'], threeCeiling);
  });

  test('offers at least one builder in every language measured', () => {
    for (const language of builderLanguages) {
      expect(queryBuilders.some((builder) => builder.language === language)).toBe(true);
    }
  });
});
