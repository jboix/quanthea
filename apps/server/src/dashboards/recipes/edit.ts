/**
 * Applies an edit to a dashboard: settings, removed panels, panels rebuilt in place, new panels
 * placed below, and deploy markers on the time charts. The result is a spec to check, test-run
 * and save like any other.
 */
import type { Annotation, DashboardSpec, Panel, SavedQuery } from '@querent/shared';
import type { PanelDraft } from './draft.ts';
import { expandPanel, isTimeChart } from './expand.ts';
import { panelId, placeBelow } from './layout.ts';
import type { EditRequest, MarkersRequest } from './request.ts';
import { markersQuery } from './sql.ts';
import { RecipeError } from './text.ts';

/** The id of the deploy markers' annotation. */
const markersId = 'markers';

/** The time range of a new dashboard. */
const defaultTime = { from: 'now-6h', to: 'now' };

/**
 * The spec an edit starts from: the current one, or an empty dashboard for the first edit.
 *
 * @param current - The current spec, if the dashboard has one.
 * @param request - The edit.
 * @returns The starting spec.
 * @throws {RecipeError} When the first edit gives no title.
 */
function startingSpec(current: DashboardSpec | undefined, request: EditRequest): DashboardSpec {
  if (current) return current;
  if (request.title === undefined) throw new RecipeError('Give the new dashboard a title.');
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
 * @throws {RecipeError} For an unknown id, listing the known ones.
 */
function checkIds(panels: readonly Panel[], ids: readonly string[]): void {
  const known = new Set(panels.map((panel) => panel.id));
  const unknown = ids.find((id) => !known.has(id));
  if (unknown !== undefined) {
    throw new RecipeError(`No panel "${unknown}". The panels are: ${[...known].join(', ')}.`);
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
function panelOf(draft: PanelDraft, id: string, grid: Panel['grid']): Panel {
  const { shape: _shape, width: _width, ...content } = draft;
  return { id, grid, ...content };
}

/**
 * The panels after the edit: removed ones gone, replaced ones rebuilt in place, new ones below.
 *
 * @param panels - The current panels.
 * @param request - The edit.
 * @param saved - The saved recipes the run may use.
 * @returns The panels.
 */
function editedPanels(
  panels: readonly Panel[],
  request: EditRequest,
  saved: readonly SavedQuery[],
): Panel[] {
  const rebuilt = new Map(
    request.panels.flatMap((panel) =>
      panel.replaces === undefined ? [] : [[panel.replaces, panel]],
    ),
  );
  checkIds(panels, [...request.remove, ...rebuilt.keys()]);
  const kept = panels
    .filter((panel) => !request.remove.includes(panel.id))
    .map((panel) => {
      const replacement = rebuilt.get(panel.id);
      return replacement ? panelOf(expandPanel(replacement, saved), panel.id, panel.grid) : panel;
    });
  const drafts = request.panels
    .filter((panel) => panel.replaces === undefined)
    .map((panel) => expandPanel(panel, saved));
  const taken = new Set(kept.map((panel) => panel.id));
  const grids = placeBelow(kept, drafts);
  const added = drafts.map((draft, index) =>
    panelOf(draft, panelId(draft.title, taken), grids[index] ?? { x: 0, y: 0, w: 12, h: 8 }),
  );
  return [...kept, ...added];
}

/**
 * The markers' annotation.
 *
 * @param request - The markers request.
 * @returns The annotation.
 */
function markersAnnotation(request: MarkersRequest): Annotation {
  return {
    id: markersId,
    label: request.label,
    query: markersQuery(request),
    timeField: 'time',
    textField: 'text',
  };
}

/**
 * The annotations after the edit: the markers set, removed, or kept as they were.
 *
 * @param annotations - The current annotations.
 * @param markers - The edit's markers: a request, `null` to remove, `undefined` to keep.
 * @returns The annotations.
 */
function editedAnnotations(
  annotations: readonly Annotation[],
  markers: EditRequest['markers'],
): Annotation[] {
  if (markers === undefined) return [...annotations];
  const others = annotations.filter((annotation) => annotation.id !== markersId);
  return markers === null ? others : [...others, markersAnnotation(markers)];
}

/**
 * Every time chart with the markers when there are markers, and without them when there are not.
 *
 * @param panels - The panels.
 * @param marked - Whether the markers' annotation exists.
 * @returns The panels.
 */
function withMarkers(panels: readonly Panel[], marked: boolean): Panel[] {
  return panels.map((panel) => {
    if (panel.view.kind !== 'chart' || !isTimeChart(panel.view)) return panel;
    const others = (panel.view.markers ?? []).filter((marker) => marker.annotation !== markersId);
    const markers = marked ? [...others, { annotation: markersId }] : others;
    const { markers: _old, ...view } = panel.view;
    return { ...panel, view: markers.length === 0 ? view : { ...view, markers } };
  });
}

/**
 * Applies an edit.
 *
 * @param current - The current spec, or `undefined` before the first version.
 * @param request - The edit.
 * @param saved - The saved recipes the run may use.
 * @returns The new spec, to check and test-run before it is saved.
 * @throws {RecipeError} When the edit names a panel that does not exist, or a recipe cannot expand.
 */
export function applyEdit(
  current: DashboardSpec | undefined,
  request: EditRequest,
  saved: readonly SavedQuery[] = [],
): DashboardSpec {
  const spec = withSettings(startingSpec(current, request), request);
  const annotations = editedAnnotations(spec.annotations, request.markers);
  const marked = annotations.some((annotation) => annotation.id === markersId);
  return {
    ...spec,
    annotations,
    panels: withMarkers(editedPanels(spec.panels, request, saved), marked),
  };
}
