/**
 * The changes the inspector's edit form makes to a draft panel: its title and description, the
 * main colour of a chart from theme tokens only, and the text of a SQL, PromQL or LogQL query. The
 * rest of a panel is edited as JSON.
 */
import { type ChartUnit, chartUnits, type Panel, type PanelQuery } from '@quanthea/shared';

/** A colour a chart may take: a theme token and its name. */
export interface ColourChoice {
  /** The token, such as `@palette.2` or `@tone.bad`. */
  readonly token: string;
  /** Its name, such as `Series 3`. */
  readonly label: string;
}

/** The series colours of the theme, in order. */
const paletteTokens = [0, 1, 2, 3, 4, 5].map((index) => `@palette.${index}`);

/** The colours a chart's main series may take: the series colours, then the states. */
export const colourChoices: readonly ColourChoice[] = [
  ...paletteTokens.map((token, index) => ({ token, label: `Series ${index + 1}` })),
  { token: '@tone.good', label: 'Good' },
  { token: '@tone.warning', label: 'Warning' },
  { token: '@tone.bad', label: 'Bad' },
  { token: '@tone.neutral', label: 'Neutral' },
];

/**
 * The main colour of a chart, if a hand edit set one: the first of its own series colours.
 *
 * @param panel - The panel.
 * @returns The token, or `undefined` for the theme's order or a panel that is no chart.
 */
export function mainColour(panel: Panel): string | undefined {
  if (panel.view.kind !== 'chart') return undefined;
  const { color } = panel.view.option;
  const first = Array.isArray(color) ? color[0] : undefined;
  return typeof first === 'string' ? first : undefined;
}

/**
 * A chart with a main colour: its first series takes the token, the next ones the other series
 * colours in order. `undefined` goes back to the theme's order.
 *
 * @param panel - The panel.
 * @param token - The token, or `undefined`.
 * @returns The panel; one that is no chart is left as it is.
 */
export function withMainColour(panel: Panel, token: string | undefined): Panel {
  if (panel.view.kind !== 'chart') return panel;
  const { color: _, ...option } = panel.view.option;
  if (token === undefined) return { ...panel, view: { ...panel.view, option } };
  const color = [token, ...paletteTokens.filter((each) => each !== token)];
  return { ...panel, view: { ...panel.view, option: { ...option, color } } };
}

/**
 * The field that holds a query's text when the form can edit it: the SQL, or a PromQL or LogQL
 * expression. Other languages are edited as JSON.
 *
 * @param query - The query.
 * @returns The key, or `undefined`.
 */
export function textKey(query: PanelQuery): 'sql' | 'expr' | undefined {
  if (query.language === 'sql') return 'sql';
  return query.language === 'promql' || query.language === 'logql' ? 'expr' : undefined;
}

/**
 * The text of a query the form can edit.
 *
 * @param query - The query.
 * @returns The SQL or the expression, or `undefined` for a query edited as JSON.
 */
export function queryTextOf(query: PanelQuery): string | undefined {
  if (query.language === 'sql') return query.sql;
  return query.language === 'promql' || query.language === 'logql' ? query.expr : undefined;
}

/**
 * A panel with one query's text changed.
 *
 * @param panel - The panel.
 * @param refId - The query.
 * @param text - Its new text.
 * @returns The panel; a query the form cannot edit is left as it is.
 */
export function withQueryText(panel: Panel, refId: string, text: string): Panel {
  const queries = panel.queries.map((query) => {
    const key = query.refId === refId ? textKey(query) : undefined;
    return key ? ({ ...query, [key]: text } as PanelQuery) : query;
  });
  return { ...panel, queries };
}

/**
 * A panel with a title and a description; an empty description is left out.
 *
 * @param panel - The panel.
 * @param fields - The title and the description.
 * @returns The panel.
 */
export function withWords(
  panel: Panel,
  fields: { readonly title: string; readonly description: string },
): Panel {
  const { description: _, ...rest } = panel;
  const description = fields.description.trim();
  return { ...rest, title: fields.title, ...(description === '' ? {} : { description }) };
}

/**
 * Whether two panels differ.
 *
 * @param before - One panel.
 * @param after - The other.
 * @returns Whether they differ.
 */
export function differs(before: unknown, after: unknown): boolean {
  return JSON.stringify(before) !== JSON.stringify(after);
}

/**
 * The unit a panel's values read in now, for a chart picked from the recipes to keep: the first
 * named formatter of its view that is a chart unit.
 *
 * @param panel - The panel.
 * @returns The unit, `number` when none is found.
 */
export function unitOf(panel: Panel): ChartUnit {
  const units: readonly string[] = chartUnits;
  const named = JSON.stringify(panel.view).matchAll(/"\$fmt":"([\w-]+)"/g);
  const found = [...named].map((match) => match[1]).find((name) => units.includes(name ?? ''));
  return (found as ChartUnit | undefined) ?? 'number';
}
