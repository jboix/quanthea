import { describe, expect, test } from 'bun:test';
import { type BuilderLanguage, builderLanguages, queryBuilders } from '@quanthea/shared';
import { panelEditSchemaFor, settingsRequestSchema } from '../dashboards/panels/index.ts';
import { providerSchema } from './tool-schema.ts';

/**
 * The most characters the edit tool's schema may have as a provider receives it, in a run whose
 * connectors speak one query language, with every builder of that language offered. Gemini took a
 * forced call of the tool at about 19,000 characters as sent and refused it at about 26,000, so
 * each ceiling sits a few hundred characters above its measure: a change that passes one is a
 * decision, not a detail. Raise a ceiling only with a number the maintainer has checked against
 * the providers. Variables, colours and markers moved to edit_settings on 14 October 2026, which
 * took 3,600 to 4,300 characters off every call.
 */
const ceilings: Record<BuilderLanguage, number> = {
  promql: 5_900,
  sql: 6_700,
  search: 7_900,
  logql: 7_900,
  mongodb: 7_600,
};

/** The ceiling of a run on a metrics source and a SQL source, the usual pair. */
const pairCeiling = 9_300;

/**
 * The ceiling of a run on three query languages: a few hundred above the largest measure, well
 * under the 19,000 Gemini is known to accept.
 */
const threeCeiling = 16_800;

/**
 * The ceiling of edit_settings, whatever the languages: a step offers it only once the agent read
 * the settings guide.
 */
const settingsCeiling = 4_600;

/** Every run on three of the query languages that have builders. */
const triples = builderLanguages.flatMap((first, at) =>
  builderLanguages
    .slice(at + 1)
    .flatMap((second, next) =>
      builderLanguages.slice(at + next + 2).map((third) => [first, second, third] as const),
    ),
);

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
  const schema = providerSchema(panelEditSchemaFor({ builtIn, saved: [] }), languages);
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

  test('stays under its ceiling for metrics with SQL', async () => {
    await expectUnder(['promql', 'sql'], pairCeiling);
  });

  test('covers every run on three languages', () => {
    expect(triples).toHaveLength(10);
    expect(triples.map((triple) => triple.join('+'))).toContain('promql+sql+search');
  });

  for (const triple of triples) {
    test(`for ${triple.join('+')} stays under ${threeCeiling}`, async () => {
      await expectUnder(triple, threeCeiling);
    });
  }

  test('leaves the settings to edit_settings, whose schema stays under its own ceiling', async () => {
    expect(await sentFor(['sql'])).not.toContain('removeMarkers');
    for (const triple of triples) {
      const size = JSON.stringify(await providerSchema(settingsRequestSchema, triple).jsonSchema);
      expect(size.length <= settingsCeiling, `${triple.join('+')} is ${size.length}`).toBe(true);
    }
  });

  test('offers at least one builder in every language measured', () => {
    for (const language of builderLanguages) {
      expect(queryBuilders.some((builder) => builder.language === language)).toBe(true);
    }
  });
});
