/**
 * Applies an edit to a dashboard: settings, removed panels, panels rebuilt in place, new panels
 * placed below, and sets of markers on time charts (markers.ts). The result is a spec to check,
 * test-run and save like any other.
 */
import type { DashboardSpec, Panel } from '@quanthea/shared';
import { type BuildContext, QueryError } from '../queries/index.ts';
import type { PanelDraft } from './draft.ts';
import { expandPanel, type PanelChart } from './expand.ts';
import { compactGrid, panelId, placeBelow } from './layout.ts';
import { placeMarkers } from './marker-placement.ts';
import { editedAnnotations } from './markers.ts';
import type { EditRequest } from './request.ts';

/** The time range of a new dashboard. */
const defaultTime = { from: 'now-6h', to: 'now' };

/**
 * The spec an edit starts from: the current one, or an empty dashboard for the first edit.
 *
 * @param current - The current spec, if the dashboard has one.
 * @param request - The edit.
 * @returns The starting spec.
 * @throws {QueryError} When the first edit gives no title.
 */
function startingSpec(current: DashboardSpec | undefined, request: EditRequest): DashboardSpec {
  if (current) return current;
  if (request.title === undefined) throw new QueryError('Give the new dashboard a title.');
  return {
    specVersion: 1,
    title: request.title,
    time: defaultTime,
    variables: [],
    panels: [],
    annotations: [],
  };
}

/**
 * The dashboard's own settings, as the edit changes them.
 *
 * @param spec - The spec.
 * @param request - The edit.
 * @returns The spec with the new title, description, time range and variables.
 */
function withSettings(spec: DashboardSpec, request: EditRequest): DashboardSpec {
  return {
    ...spec,
    ...(request.title === undefined ? {} : { title: request.title }),
    ...(request.description === undefined ? {} : { description: request.description }),
    ...(request.time === undefined ? {} : { time: request.time }),
    ...(request.variables === undefined ? {} : { variables: request.variables }),
  };
}

/**
 * Checks that every panel id an edit names exists.
 *
 * @param panels - The panels.
 * @param ids - The ids the edit names.
 * @throws {QueryError} For an unknown id, listing the known ones.
 */
function checkIds(panels: readonly Panel[], ids: readonly string[]): void {
  const known = new Set(panels.map((panel) => panel.id));
  const unknown = ids.find((id) => !known.has(id));
  if (unknown !== undefined) {
    throw new QueryError(
      `No panel "${unknown}". The panels are: ${[...known].join(', ')}. A panel the draft does not have, such as one left out, is new: send it without "replaces".`,
    );
  }
}

/**
 * A panel from a draft.
 *
 * @param draft - The draft.
 * @param id - Its id.
 * @param grid - Its place.
 * @returns The panel.
 */
function panelOf(
  draft: PanelDraft & { chart?: PanelChart },
  id: string,
  grid: Panel['grid'],
): Panel {
  const { shape: _shape, width: _width, chart: _chart, ...content } = draft;
  return { id, grid, ...content };
}

/**
 * The edit's panels, each new one that has the title of a current panel set to replace it, so a
 * model that sends the whole dashboard again changes it in place.
 *
 * @param panels - The current panels.
 * @param requested - The edit's panels.
 * @returns The panels, with `replaces` set where a title matches.
 */
function matchedByTitle(
  panels: readonly Panel[],
  requested: EditRequest['panels'],
): EditRequest['panels'] {
  const keyOf = (title: string) => title.trim().toLowerCase();
  const taken = new Set(requested.flatMap((panel) => panel.replaces ?? []));
  const byTitle = new Map(panels.map((panel) => [keyOf(panel.title), panel.id]));
  return requested.map((panel) => {
    const id = byTitle.get(keyOf(panel.title));
    if (panel.replaces !== undefined || id === undefined || taken.has(id)) return panel;
    taken.add(id);
    return { ...panel, replaces: id };
  });
}

/** The charts of the panels an edit builds, by panel id, to complete after they run. */
export type ChartChoices = Map<string, PanelChart>;

/**
 * The panels after the edit: removed ones gone, replaced ones rebuilt in place, new ones below.
 *
 * @param panels - The current panels.
 * @param request - The edit.
 * @param context - The saved queries the run may use, and each connector's dialect.
 * @param charts - Receives the chart choice of each panel built.
 * @returns The panels.
 */
function editedPanels(
  panels: readonly Panel[],
  request: EditRequest,
  context: BuildContext,
  charts: ChartChoices,
): Panel[] {
  const requested = matchedByTitle(panels, request.panels);
  const rebuilt = new Map(
    requested.flatMap((panel) => (panel.replaces === undefined ? [] : [[panel.replaces, panel]])),
  );
  checkIds(panels, [...request.remove, ...rebuilt.keys()]);
  const kept = panels
    .filter((panel) => !request.remove.includes(panel.id))
    .map((panel) => {
      const replacement = rebuilt.get(panel.id);
      if (!replacement) return panel;
      const draft = expandPanel(replacement, context);
      charts.set(panel.id, draft.chart);
      return panelOf(draft, panel.id, panel.grid);
    });
  const drafts = requested
    .filter((panel) => panel.replaces === undefined)
    .map((panel) => expandPanel(panel, context));
  const taken = new Set(kept.map((panel) => panel.id));
  const grids = placeBelow(kept, drafts);
  const added = drafts.map((draft, index) => {
    const id = panelId(draft.title, taken);
    charts.set(id, draft.chart);
    return panelOf(draft, id, grids[index] ?? { x: 0, y: 0, w: 12, h: 8 });
  });
  return [...kept, ...added];
}

/**
 * Applies an edit.
 *
 * @param current - The current spec, or `undefined` before the first version.
 * @param request - The edit.
 * @param context - The saved queries the run may use, and each connector's dialect.
 * @returns The new spec, to test-run, complete, check and save, and the chart choice of each
 *   panel it builds.
 * @throws {QueryError} When the edit names a panel that does not exist, or a panel cannot build.
 */
export function applyEdit(
  current: DashboardSpec | undefined,
  request: EditRequest,
  context: BuildContext = { saved: [] },
): { spec: DashboardSpec; charts: ChartChoices } {
  const spec = withSettings(startingSpec(current, request), request);
  const annotations = editedAnnotations(spec.annotations, request, context);
  const charts: ChartChoices = new Map();
  const edited = editedPanels(spec.panels, request, context, charts);
  // Removed panels leave holes; the rest move up into them.
  const placed = request.remove.length > 0 ? compactGrid(edited) : edited;
  const panels = placeMarkers(spec.panels, placed, annotations, request);
  return { spec: { ...spec, annotations, panels }, charts };
}
