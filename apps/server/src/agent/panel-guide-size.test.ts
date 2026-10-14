import { describe, expect, test } from 'bun:test';
import { type BuilderLanguage, chartRecipes, queryBuilders } from '@quanthea/shared';
import { panelGuideFor } from './panel-guide.ts';

/**
 * The most characters the panel guide may have in a run on a metrics source and a SQL source,
 * with every builder of both offered, no saved query and no connector guide. Every writing turn
 * carries the guide, so what a chart needs only sometimes belongs in its recipe, which
 * chart_recipe gives on demand. The ceiling sits a little above the measure: a change that
 * passes it is a decision, not a detail. On 14 October 2026 the variables moved to the settings
 * guide, the search filters to their own, and what to do with layout advice to the advice.
 */
const pairCeiling = 10_800;

/** The ceiling of the guide in a run on metrics, SQL and search together. */
const threeCeiling = 12_200;

/**
 * The panel guide of a run about some query languages, with every builder of those languages.
 *
 * @param languages - The languages of the connectors in use.
 * @returns The guide.
 */
function guideFor(languages: readonly BuilderLanguage[]): string {
  const builtIn = queryBuilders
    .filter((builder) => languages.includes(builder.language))
    .map((builder) => builder.id);
  return panelGuideFor({ queries: { builtIn, saved: [] }, languages, guides: [] });
}

/**
 * Checks the guide's size against its ceiling, saying both when it is over.
 *
 * @param languages - The languages measured.
 * @param ceiling - The most characters allowed.
 */
function expectUnder(languages: readonly BuilderLanguage[], ceiling: number): void {
  const size = guideFor(languages).length;
  const message = `The panel guide for ${languages.join('+')} is ${size} characters, over its ceiling of ${ceiling}.`;
  expect(size <= ceiling, message).toBe(true);
}

describe('the size of the panel guide', () => {
  test('stays under its ceiling for metrics with SQL, and for both with search', () => {
    expectUnder(['promql', 'sql'], pairCeiling);
    expectUnder(['promql', 'sql', 'search'], threeCeiling);
  });

  test('names where mappings go and their tones, and leaves their forms to the recipes', () => {
    const guide = guideFor(['promql', 'sql']);
    expect(guide).toContain(
      'on a column of a table (options.columns), on kpi.stat and on kpi.gauge',
    );
    expect(guide).toContain('neutral, good, warning, bad, or series1 to series8, never a colour');
    expect(guide).not.toContain('"toneAs"');
    expect(guide).not.toContain('"null": true');
    for (const id of ['table.rows', 'kpi.stat', 'kpi.gauge']) {
      const pitfalls = chartRecipes.find((recipe) => recipe.id === id)?.pitfalls.join(' ') ?? '';
      expect(pitfalls).toContain('"match": { "from"');
      expect(pitfalls).toContain('"tone": "bad"');
    }
  });
});
