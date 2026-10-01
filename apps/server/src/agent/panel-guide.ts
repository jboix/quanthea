/**
 * The guide to edit_dashboard for one thread: the query builders and saved queries it may use and
 * the columns each returns, raw queries, the shapes of data, the chart recipes, and the query guide
 * of each connector kind in use.
 */
import {
  type BuilderLanguage,
  builderLanguages,
  chartIndex,
  chartRecipes,
  queryBuilders,
  queryLanguageNames,
  type SavedQuery,
  shapeGuides,
  shapeKinds,
} from '@querent/shared';
import type { AvailableQueries } from '../dashboards/queries/index.ts';
import {
  builderHints,
  chartGuide,
  editRules,
  panelIntro,
  rawGuide,
  savedGuide,
} from './prompt-text.ts';

/**
 * The line of the query builders of one language.
 *
 * @param label - Such as `PromQL builders`.
 * @param language - The language.
 * @param ids - The builders the thread may use.
 * @returns The line, or nothing when it may use none of them.
 */
function builderLines(label: string, language: BuilderLanguage, ids: readonly string[]) {
  const listed = queryBuilders
    .filter((builder) => builder.language === language && ids.includes(builder.id))
    .map((builder) => `- ${builder.id}: ${builderHints[builder.id] ?? builder.description}`);
  return listed.length === 0 ? [] : [`${label} ({ "kind": id, "connector", …fields }):`, ...listed];
}

/**
 * One saved query as the guide lists it.
 *
 * @param query - The saved query.
 * @returns Such as `- "queue-depth" (promql, long): What it returns. Placeholders: metric (metric).`
 */
function savedLine(query: SavedQuery): string {
  const params = query.params.map((param) => {
    const described = param.description === '' ? '' : `: ${param.description}`;
    return `${param.name} (${param.kind}${described})`;
  });
  const placeholders = params.length === 0 ? '' : ` Placeholders: ${params.join('; ')}.`;
  return `- "${query.id}" (${query.language}, ${query.shape}): ${query.description}${placeholders}`;
}

/**
 * The lines about data: the builders by language, the saved queries, and raw queries.
 *
 * @param available - The builders and saved queries.
 * @returns The lines.
 */
function dataLines(available: AvailableQueries): string[] {
  const none = available.builtIn.length === 0 && available.saved.length === 0;
  return [
    ...builderLanguages.flatMap((language) =>
      builderLines(`${queryLanguageNames[language]} builders`, language, available.builtIn),
    ),
    ...(available.saved.length === 0 ? [] : [savedGuide, ...available.saved.map(savedLine)]),
    none
      ? `${rawGuide} This thread uses no query builders: every panel's data is a raw query.`
      : `${rawGuide} Prefer builders: their queries do not break.`,
  ];
}

/**
 * The guide to edit_dashboard with the queries a thread may use.
 *
 * @param available - The builders and saved queries.
 * @param guides - The query guides of the connector kinds in use.
 * @param charts - The chart recipes offered, by id; every one when not given.
 * @returns The guide.
 */
export function panelGuideFor(
  available: AvailableQueries,
  guides: readonly { readonly text: string }[],
  charts?: readonly string[],
): string {
  const offered = charts
    ? chartRecipes.filter((recipe) => charts.includes(recipe.id))
    : chartRecipes;
  const shapes = shapeKinds.map((kind) => `- ${kind}: ${shapeGuides[kind]}`);
  return [
    panelIntro,
    'Data, the "data" of a panel:',
    ...dataLines(available),
    'Shapes of data:',
    ...shapes,
    chartGuide,
    'Chart recipes, id (shape): when to use it:',
    chartIndex(offered),
    ...guides.map((guide) => guide.text),
    editRules,
  ].join('\n');
}
