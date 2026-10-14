/**
 * The checks of a built dashboard, and the evidence they read. Each check is one assertion, pure,
 * so a saved report can be scored again with no model call (`--rescore`).
 */
import { fixedTimeOf, type PanelGrid, type PanelQuery, type TurnUsage } from '@quanthea/shared';
import type { Check } from '../core/case.ts';
import type { PanelResult } from '../surfaces/panel-results.ts';
import { type BuiltShape, closestFaults, holdsField, type ShapeExpectation } from './shape.ts';

/** One panel of the dashboard built, as the scoring reads it. */
export interface BuiltPanel extends BuiltShape {
  /** Its id. */
  readonly id: string;
  /** Its title. */
  readonly title: string;
  /** The connectors its queries use. */
  readonly connectors: readonly string[];
  /** Its title and queries, written out, for the topics. */
  readonly text: string;
  /** Its view's kind, such as `stat` or `chart`; absent in reports written before it was kept. */
  readonly kind?: string;
  /** Its place on the grid; absent in reports written before it was kept. */
  readonly grid?: PanelGrid;
  /** The definition its data was copied from, by id, when it was. */
  readonly definition?: string;
}

/** What happened when the agent answered a question. */
export interface Outcome {
  /** The question's id. */
  readonly id: string;
  /** Whether the thread ended with a dashboard ready for edits. */
  readonly built: boolean;
  /** The panels of the last version. */
  readonly panels: readonly BuiltPanel[];
  /** The marker sets of the last version, each shaped like a panel, if it has any. */
  readonly markers?: readonly BuiltPanel[];
  /** The last version around its panels and markers, such as its variables; absent before it was kept. */
  readonly dashboard?: Readonly<Record<string, unknown>>;
  /** What each panel of the last version returned, kept small; absent before it was kept. */
  readonly results?: readonly PanelResult[];
  /** The queries of the last version that fail when run again, by panel. */
  readonly failing: readonly { readonly panelId: string; readonly error: string }[];
  /** How many writes failed their checks or test runs. */
  readonly repairs: number;
  /** What the agent asked the person. */
  readonly asked: readonly string[];
  /** How many runs it took. */
  readonly turns: number;
  /** The tokens spent, by model. */
  readonly usage: TurnUsage;
  /** How long it took, in milliseconds. */
  readonly durationMs: number;
  /** Why a run failed, when one did, such as a provider error. */
  readonly error?: string;
  /** What the agent said last, to read when nothing was built. */
  readonly lastWords?: string;
}

/**
 * A panel's queries: those the outcome keeps, else those in its text, which is its title, then
 * its queries as JSON.
 *
 * @param panel - The panel.
 * @returns Its queries; none when the text holds none.
 */
export function panelQueries(panel: BuiltPanel): PanelQuery[] {
  if (panel.queries) return [...panel.queries];
  try {
    return JSON.parse(panel.text.slice(panel.text.indexOf('\n') + 1)) as PanelQuery[];
  } catch {
    return [];
  }
}

/**
 * What the dashboard shows: its panels, then its marker sets.
 *
 * @param outcome - What was built.
 * @returns The panels and the marker sets.
 */
export function shownOf(outcome: Outcome): BuiltPanel[] {
  return [...outcome.panels, ...(outcome.markers ?? [])];
}

/**
 * A topic pattern, for a reason: its alternatives joined with "or".
 *
 * @param topic - The pattern.
 * @returns The words.
 */
export function topicWords(topic: RegExp): string {
  return topic.source.split('|').join(' or ');
}

/** A check of a built dashboard. */
export type DashboardCheck = Check<Outcome>;

/** The thread ended with a dashboard. Nothing else can be checked without one. */
export const built: DashboardCheck = {
  id: 'built',
  kind: 'structure',
  gate: true,
  faults: (outcome) => (outcome.built ? [] : ['no dashboard was built']),
};

/** Every query of the last version runs when run again. */
export const everyPanelRuns: DashboardCheck = {
  id: 'every-panel-runs',
  kind: 'structure',
  faults: (outcome) =>
    outcome.failing.map((failure) => `${failure.panelId} fails: ${failure.error}`),
};

/** No query names a fixed time instead of following the dashboard's range. */
export const noFixedDates: DashboardCheck = {
  id: 'no-fixed-dates',
  kind: 'structure',
  faults: (outcome) =>
    shownOf(outcome).flatMap((panel) =>
      panelQueries(panel).flatMap((query) => {
        const why = fixedTimeOf(query);
        return why ? [`${panel.id}: ${why.split(':')[0]}`] : [];
      }),
    ),
};

/**
 * Panels that run the same query as an earlier one of the same kind. A stat and a chart of the
 * same query are a headline and its trend, a common design, not a duplicate.
 *
 * @param outcome - What was built.
 * @returns The faults.
 */
function duplicates(outcome: Outcome): string[] {
  const seen = new Map<string, string>();
  const reasons: string[] = [];
  for (const panel of outcome.panels) {
    const queries = panelQueries(panel);
    if (queries.length === 0) continue;
    const same = queries.map(({ refId: _refId, ...query }) => query);
    const key = JSON.stringify([panel.kind ?? '', same]);
    const first = seen.get(key);
    if (first) reasons.push(`${panel.id} runs the same query as ${first}`);
    else seen.set(key, panel.id);
  }
  return reasons;
}

/** No two panels of the same kind run the same query. */
export const noDuplicateQueries: DashboardCheck = {
  id: 'no-duplicate-queries',
  kind: 'structure',
  faults: duplicates,
};

/** The checks every dashboard case runs before its own. */
export const dashboardDefaults: readonly DashboardCheck[] = [
  built,
  everyPanelRuns,
  noFixedDates,
  noDuplicateQueries,
];

/**
 * The dashboard has a number of panels in a range.
 *
 * @param least - The fewest panels.
 * @param most - The most panels; the same as the fewest when left out.
 * @returns The check.
 */
export function panelCount(least: number, most: number = least): DashboardCheck {
  const faults = ({ panels }: Outcome) =>
    panels.length < least || panels.length > most
      ? [`${panels.length} panels, expected ${least} to ${most}`]
      : [];
  return { id: 'panel-count', kind: 'structure', faults };
}

/**
 * The build took no more failed writes than allowed.
 *
 * @param most - The most failed writes.
 * @returns The check.
 */
export function maxRepairs(most: number): DashboardCheck {
  const faults = ({ repairs }: Outcome) =>
    repairs > most ? [`${repairs} failed writes, at most ${most}`] : [];
  return { id: 'max-repairs', kind: 'structure', faults };
}

/**
 * A panel or a marker set queries a connector.
 *
 * @param connector - The connector's name.
 * @returns The check.
 */
export function queries(connector: string): DashboardCheck {
  const faults = (outcome: Outcome) =>
    shownOf(outcome).some((panel) => panel.connectors.includes(connector))
      ? []
      : [`never queries ${connector}`];
  return { id: `queries:${connector}`, kind: 'structure', faults };
}

/**
 * A pattern matches a panel's title or query, or a marker set's. It stands in for a reading of
 * what the dashboard shows, until a rubric or a result check does it.
 *
 * @param pattern - The pattern.
 * @param standsInFor - What replaces it: a rubric, or a result check for a pattern over a query.
 * @returns The check.
 */
export function topic(
  pattern: RegExp,
  standsInFor: NonNullable<DashboardCheck['standsInFor']> = 'rubric',
): DashboardCheck {
  const faults = (outcome: Outcome) =>
    shownOf(outcome).some((panel) => pattern.test(panel.text))
      ? []
      : [`no panel about ${topicWords(pattern)}`];
  return { id: `topic:${pattern.source}`, kind: 'legacy', standsInFor, pattern, faults };
}

/** The charts carry a marker set. */
export const hasMarkers: DashboardCheck = {
  id: 'has-markers',
  kind: 'feature',
  faults: (outcome) => ((outcome.markers ?? []).length > 0 ? [] : ['no markers on the charts']),
};

/**
 * A pattern matches a marker set's label or query. A dashboard with no marker set fails
 * {@link hasMarkers}, not this.
 *
 * @param pattern - The pattern.
 * @returns The check.
 */
export function markerTopic(pattern: RegExp): DashboardCheck {
  const faults = ({ markers = [] }: Outcome) =>
    markers.length === 0 || markers.some((marker) => pattern.test(marker.text))
      ? []
      : [`no markers about ${topicWords(pattern)}`];
  return { id: `marker-topic:${pattern.source}`, kind: 'legacy', standsInFor: 'rubric', faults };
}

/**
 * A marker set queries a connector. A dashboard with no marker set fails {@link hasMarkers}, not
 * this.
 *
 * @param connector - The connector's name.
 * @returns The check.
 */
export function markersFrom(connector: string): DashboardCheck {
  const faults = ({ markers = [] }: Outcome) =>
    markers.length === 0 || markers.some((marker) => marker.connectors.includes(connector))
      ? []
      : [`no markers from ${connector}`];
  return { id: `markers-from:${connector}`, kind: 'structure', faults };
}

/**
 * How one panel gets its data: the data kind asked, its aggregations and its operations, read on
 * the panel that comes closest to the whole shape. It says how a query is written, not what it
 * returns, so a result check replaces it where one can be computed.
 *
 * @param expect - The shape.
 * @returns The check.
 */
export function shapeData(expect: ShapeExpectation): DashboardCheck {
  const faults = (outcome: Outcome) => {
    const closest = closestFaults(outcome.panels, expect);
    return (closest?.data ?? []).map((reason) => `${closest?.id}: ${reason}`);
  };
  return { id: 'shape-data', kind: 'legacy', standsInFor: 'result', faults };
}

/**
 * How one panel shows its data: its view's kind, its recipe and the fields it must hold, read on
 * the panel that comes closest to the whole shape.
 *
 * @param expect - The shape.
 * @returns The check.
 */
export function shapeView(expect: ShapeExpectation): DashboardCheck {
  const faults = (outcome: Outcome) => {
    const closest = closestFaults(outcome.panels, expect);
    return (closest?.view ?? []).map((reason) => `${closest?.id}: ${reason}`);
  };
  return { id: 'shape-view', kind: 'feature', faults };
}

/**
 * The dashboard holds a field around its panels, written as a path, such as
 * `variables.kind=computed` or `sections.repeat`.
 *
 * @param path - The field, and after `=` the value it must have, if any.
 * @returns The check.
 */
export function dashboardHas(path: string): DashboardCheck {
  const faults = (outcome: Outcome) =>
    holdsField(outcome.dashboard, path) ? [] : [`the dashboard has no ${path}`];
  return { id: `dashboard-has:${path}`, kind: 'feature', faults };
}

/**
 * Every variable of the dashboard has a label, the words its chip shows in place of `$name`.
 *
 * @returns The check.
 */
export function variablesLabelled(): DashboardCheck {
  const faults = (outcome: Outcome) => {
    const variables = outcome.dashboard?.variables;
    if (!Array.isArray(variables)) return [];
    return variables
      .filter((variable: { label?: unknown }) => typeof variable.label !== 'string')
      .map((variable: { name?: unknown }) => `the variable ${String(variable.name)} has no label`);
  };
  return { id: 'variables-labelled', kind: 'feature', faults };
}

/**
 * A panel's data was copied from a definition, so it holds that definition's checked filters
 * exactly and records the definition.
 *
 * @param id - The definition's id.
 * @returns The check.
 */
export function copiesDefinition(id: string): DashboardCheck {
  const faults = (outcome: Outcome) =>
    outcome.panels.some((panel) => panel.definition === id)
      ? []
      : [`no panel was built from the definition ${id}`];
  return { id: `copies-definition:${id}`, kind: 'feature', faults };
}
