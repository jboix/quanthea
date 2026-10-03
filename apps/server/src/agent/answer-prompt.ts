/**
 * The instructions of an answer about a dashboard: the rules of its mode, then the facts. The
 * facts are the dashboard as written (never data), the connectors with what the model may read of
 * each, and, for a question, the range asked about and the variables chosen.
 */
import { allValue, type DashboardSpec, type Panel, type VariableValues } from '@quanthea/shared';

/** How a question about the data is answered. */
const askRules = `You answer questions about one dashboard for the person looking at it: a calm, precise colleague who reads the data before saying anything about it.

Rules:
- Answer from evidence only: the dashboard below and what read_data returns. Never guess or invent a number, a time or a cause.
- Read before you answer. read_data with a "panelId" runs that panel's query; with a "connector" and a "query" it runs a query of your own. Both use the dashboard's variables and the range asked about; set "time" to look closer at a moment, or to read a baseline outside the range, such as the day before. Answer with give_answer in a step of its own, after your reads.
- Cite with markers [1], [2], in order. Every number and every claim about the data has one. A marker's citation names the read that shows it (evidenceId), the panel it is about (panelId), and, for a moment or a period, the window to shade (from, to). A read may cover any window; a citation window lies inside the range asked about.
- Give times as absolute times in the dashboard's time zone, such as "14:05 to 14:20". Never "recently" or "earlier".
- Say what you could not see: a connector you cannot read, a query that failed, a field the access level hides.
- Short: two to four plain sentences. No headings, no tables, no lists unless asked. Answer in the person's language.
- End with give_answer: only what you give there reaches the person. If it reports issues, fix them and call it again.`;

/** How a panel is explained, with no data. */
const explainRules = `You explain one panel of a dashboard to everyone who opens it: what it measures, where its data comes from, and how to read it.

Rules:
- You have no data and must not quote any: no values, counts, trends or times from the data. Work from the dashboard below and the schema (describe) only.
- Say what the panel's query computes, from which connector and table or metric, filtered by which variables, and what a rise or a fall would mean.
- Short: two to four plain sentences. No headings, no tables, no lists. Write in the language of the dashboard's title.
- Cite the panel with [1] (its panelId), and any other panel you mention likewise. Never an evidenceId or a time window.
- End with give_answer. If it reports issues, fix them and call it again.`;

/** What the model is told when it can read no connector of the dashboard. */
const cannotRead = `You cannot read the numbers of this dashboard: its connectors show schemas and metadata only, so you can say what the panels measure, not what the data shows. Say so plainly in your first sentence, and never quote a measurement.`;

/** A connector of the dashboard as the answer sees it. */
export interface AnswerConnector {
  /** The name. */
  readonly name: string;
  /** The kind, such as `postgres`. */
  readonly kind: string;
  /** Its query language. */
  readonly language: string;
  /** Its access level. */
  readonly accessLevel: number;
}

/** The facts of a question. */
export interface AskFacts {
  /** The spec. */
  readonly spec: DashboardSpec;
  /** The dashboard's connectors that exist. */
  readonly connectors: readonly AnswerConnector[];
  /** The range asked about, epoch milliseconds. */
  readonly range: { readonly from: number; readonly to: number };
  /** The dashboard's time zone. */
  readonly timeZone: string;
  /** The variables the viewer chose. */
  readonly variables: VariableValues;
}

/**
 * A time in a zone, such as `2026-10-03, 14:05`; UTC when the zone is unknown.
 *
 * @param instant - Epoch milliseconds.
 * @param timeZone - An IANA time zone.
 * @returns The time.
 */
function localTime(instant: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      dateStyle: 'short',
      timeStyle: 'short',
      hourCycle: 'h23',
    }).format(instant);
  } catch {
    return `${new Date(instant).toISOString()} (UTC)`;
  }
}

/**
 * A panel as the model reads it: what it shows and the queries behind it, without the chart's
 * drawing options.
 *
 * @param panel - The panel.
 * @returns The panel's outline.
 */
function panelOutline(panel: Panel) {
  const { view } = panel;
  const shown =
    view.kind === 'chart'
      ? { kind: view.kind, recipe: view.recipe?.id, roles: view.roles, markers: view.markers }
      : view;
  const queries = panel.queries;
  return { id: panel.id, title: panel.title, description: panel.description, queries, view: shown };
}

/**
 * The dashboard as the model reads it.
 *
 * @param spec - The spec.
 * @returns JSON text.
 */
function dashboardText(spec: DashboardSpec): string {
  const { title, description, variables, annotations } = spec;
  const panels = spec.panels.map(panelOutline);
  return JSON.stringify({ title, description, variables, panels, markers: annotations });
}

/**
 * One line per connector: what the model may read of it.
 *
 * @param connectors - The dashboard's connectors.
 * @param readable - Whether a level lets the model read numbers.
 * @returns The lines.
 */
function connectorLines(
  connectors: readonly AnswerConnector[],
  readable: (level: number) => boolean,
): string[] {
  return connectors.map(({ name, kind, language, accessLevel }) => {
    const access = readable(accessLevel)
      ? `level ${accessLevel}: read_data returns ${accessLevel >= 4 ? 'summaries and rows' : 'summaries, never rows'}`
      : `level ${accessLevel}: you cannot read its numbers`;
    return `- ${name} (${kind}, ${language}): ${access}.`;
  });
}

/**
 * The viewer's variable choices, in words; "All" for every option.
 *
 * @param spec - The spec, for the declarations and defaults.
 * @param chosen - The choices.
 * @returns The line, or `undefined` without variables.
 */
function variablesLine(spec: DashboardSpec, chosen: VariableValues): string | undefined {
  if (spec.variables.length === 0) return undefined;
  const values = spec.variables.map((variable) => {
    const value = [chosen[variable.name] ?? variable.default ?? ''].flat();
    const words = value.includes(allValue) ? 'All' : value.join(', ');
    return `$${variable.name} = ${words}`;
  });
  return `Variables chosen: ${values.join('; ')}.`;
}

/**
 * The instructions of a question about the data.
 *
 * @param facts - The dashboard, its connectors, the range, the zone and the variables.
 * @param readable - Whether a level lets the model read numbers.
 * @returns The instructions.
 */
export function askInstructions(facts: AskFacts, readable: (level: number) => boolean): string {
  const { range, timeZone } = facts;
  const iso = `${new Date(range.from).toISOString()} to ${new Date(range.to).toISOString()}`;
  const local = `${localTime(range.from, timeZone)} to ${localTime(range.to, timeZone)}`;
  const anyReadable = facts.connectors.some((connector) => readable(connector.accessLevel));
  return [
    askRules,
    ...(anyReadable ? [] : [cannotRead]),
    '',
    `The range asked about: ${local} in ${timeZone}, that is ${iso}.`,
    ...[variablesLine(facts.spec, facts.variables)].filter((line) => line !== undefined),
    'Connectors:',
    ...connectorLines(facts.connectors, readable),
    'Dashboard:',
    dashboardText(facts.spec),
  ].join('\n');
}

/**
 * The instructions of a panel's explanation.
 *
 * @param spec - The spec.
 * @param panel - The panel to explain.
 * @param connectors - The dashboard's connectors.
 * @returns The instructions.
 */
export function explainInstructions(
  spec: DashboardSpec,
  panel: Panel,
  connectors: readonly AnswerConnector[],
): string {
  const lines = connectors.map(({ name, kind, language }) => `- ${name} (${kind}, ${language}).`);
  return [
    explainRules,
    '',
    `The panel to explain: "${panel.title}" (panelId ${panel.id}).`,
    'Connectors:',
    ...lines,
    'Dashboard:',
    dashboardText(spec),
  ].join('\n');
}
