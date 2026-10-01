/**
 * The guide to edit_dashboard for one thread: the query builders and saved queries it may use and
 * the columns each returns, raw queries in the languages in use, the shapes of data, the chart
 * recipes, and the connector kinds whose query guide read_guide gives.
 */
import {
  type BuilderLanguage,
  builderLanguages,
  chartIndex,
  chartRecipes,
  type QueryLanguage,
  queryBuilders,
  queryLanguageNames,
  queryLanguages,
  type SavedQuery,
  shapeGuides,
  shapeKinds,
} from '@quanthea/shared';
import type { AvailableQueries } from '../dashboards/queries/index.ts';
import {
  builderHints,
  chartGuide,
  editRules,
  guidesLine,
  panelIntro,
  rawGuide,
  rawSyntax,
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

/** What the panel guide depends on. */
export interface PanelGuideFacts {
  /** The query builders and saved queries the thread may use. */
  readonly queries: AvailableQueries;
  /** The query languages of the connectors in use. */
  readonly languages: readonly QueryLanguage[];
  /** The connector kinds in use that have a query guide. */
  readonly guides: readonly { readonly kind: string }[];
  /** The chart recipes offered, by id; every one when not given. */
  readonly charts?: readonly string[] | undefined;
}

/**
 * The lines about data: the builders by language, the saved queries, raw queries in the languages
 * in use, and where the connector kinds' guides are.
 *
 * @param facts - The queries, languages and guides.
 * @returns The lines.
 */
function dataLines(facts: PanelGuideFacts): string[] {
  const available = facts.queries;
  const none = available.builtIn.length === 0 && available.saved.length === 0;
  const syntax = queryLanguages
    .filter((language) => facts.languages.includes(language))
    .map((language) => rawSyntax[language]);
  const raw = [rawGuide, ...syntax].join(' ');
  return [
    ...builderLanguages.flatMap((language) =>
      builderLines(`${queryLanguageNames[language]} builders`, language, available.builtIn),
    ),
    ...(available.saved.length === 0 ? [] : [savedGuide, ...available.saved.map(savedLine)]),
    none
      ? `${raw} This thread uses no query builders: every panel's data is a raw query.`
      : `${raw} Prefer builders: their queries do not break.`,
    ...(facts.guides.length === 0 ? [] : [guidesLine(facts.guides.map((guide) => guide.kind))]),
  ];
}

/**
 * The guide to edit_dashboard with the queries a thread may use.
 *
 * @param facts - The queries, languages, guides and charts of the thread.
 * @returns The guide.
 */
export function panelGuideFor(facts: PanelGuideFacts): string {
  const { charts } = facts;
  const offered = charts
    ? chartRecipes.filter((recipe) => charts.includes(recipe.id))
    : chartRecipes;
  const shapes = shapeKinds.map((kind) => `- ${kind}: ${shapeGuides[kind]}`);
  return [
    panelIntro,
    'Data, the "data" of a panel:',
    ...dataLines(facts),
    'Shapes of data:',
    ...shapes,
    chartGuide,
    'Chart recipes, id (shape): when to use it:',
    chartIndex(offered),
    editRules,
  ].join('\n');
}
