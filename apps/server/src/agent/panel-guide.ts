/**
 * The guide to edit_dashboard for one thread: the query builders and saved queries it may use and
 * the columns each returns, raw queries, the shapes of data, the chart recipes, and the query guide
 * of each connector kind in use.
 */
import {
  chartIndex,
  queryBuilders,
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
function builderLines(label: string, language: 'sql' | 'promql', ids: readonly string[]) {
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
 * The guide to edit_dashboard with the queries a thread may use.
 *
 * @param available - The builders and saved queries.
 * @param guides - The query guides of the connector kinds in use.
 * @returns The guide.
 */
export function panelGuideFor(
  available: AvailableQueries,
  guides: readonly { readonly text: string }[],
): string {
  const none = available.builtIn.length === 0 && available.saved.length === 0;
  const data = [
    ...builderLines('PromQL builders', 'promql', available.builtIn),
    ...builderLines('SQL builders', 'sql', available.builtIn),
    ...(available.saved.length === 0 ? [] : [savedGuide, ...available.saved.map(savedLine)]),
    none
      ? `${rawGuide} This thread uses no query builders: every panel's data is a raw query.`
      : `${rawGuide} Prefer builders: their queries do not break.`,
  ];
  const shapes = shapeKinds.map((kind) => `- ${kind}: ${shapeGuides[kind]}`);
  return [
    panelIntro,
    'Data, the "data" of a panel:',
    ...data,
    'Shapes of data:',
    ...shapes,
    chartGuide,
    'Chart recipes, id (shape): when to use it:',
    chartIndex(),
    ...guides.map((guide) => guide.text),
    editRules,
  ].join('\n');
}
