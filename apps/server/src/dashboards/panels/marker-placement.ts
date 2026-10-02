/**
 * Where each set of markers shows: on every time chart, or on the panels the edit names. A set the
 * edit leaves out keeps its charts: a rebuilt chart keeps it, and a new time chart gets it when
 * every time chart had it.
 */
import type { Annotation, Panel } from '@quanthea/shared';
import { QueryError } from '../queries/index.ts';
import { isTimeChart } from './expand.ts';
import type { MarkersEdit } from './markers.ts';
import type { MarkersRequest } from './request.ts';

/**
 * Whether a panel is a time chart.
 *
 * @param panel - The panel.
 * @returns Whether its x axis is time.
 */
function isTimePanel(panel: Panel): boolean {
  return panel.view.kind === 'chart' && isTimeChart(panel.view);
}

/**
 * Whether a panel shows a set of markers.
 *
 * @param panel - The panel.
 * @param id - The set's id.
 * @returns Whether its chart names the set's annotation.
 */
function showsMarkers(panel: Panel, id: string): boolean {
  return (
    panel.view.kind === 'chart' &&
    (panel.view.markers ?? []).some((marker) => marker.annotation === id)
  );
}

/**
 * The panels an edit names for a set of markers, by id or title.
 *
 * @param panels - The panels after the edit.
 * @param id - The set's id.
 * @param names - Their ids or titles.
 * @returns Their ids.
 * @throws {QueryError} When a name is no panel, or a panel is not a time chart.
 */
function namedPanels(panels: readonly Panel[], id: string, names: readonly string[]): Set<string> {
  const keyOf = (text: string) => text.trim().toLowerCase();
  return new Set(
    names.map((name) => {
      const panel = panels.find((each) => each.id === name || keyOf(each.title) === keyOf(name));
      if (!panel)
        throw new QueryError(
          `No panel "${name}" to show the markers "${id}". The panels are: ${panels.map((each) => each.id).join(', ')}.`,
        );
      if (!isTimePanel(panel))
        throw new QueryError(`Markers go on time charts, and "${panel.title}" is not one.`);
      return panel.id;
    }),
  );
}

/**
 * The panels that keep showing a set the edit leaves as it was: those that showed it, and new time
 * charts when every time chart showed it.
 *
 * @param before - The panels before the edit.
 * @param after - The panels after it.
 * @param id - The set's id.
 * @returns Their ids.
 */
function keptPanels(before: readonly Panel[], after: readonly Panel[], id: string): Set<string> {
  const charts = before.filter(isTimePanel);
  const everyChart = charts.length > 0 && charts.every((panel) => showsMarkers(panel, id));
  const known = new Set(before.map((panel) => panel.id));
  const fresh = everyChart
    ? after.filter((panel) => !known.has(panel.id) && isTimePanel(panel))
    : [];
  const showing = before.filter((panel) => showsMarkers(panel, id));
  return new Set([...showing, ...fresh].map((panel) => panel.id));
}

/**
 * The panels that show a set of markers after the edit.
 *
 * @param before - The panels before the edit.
 * @param after - The panels after it.
 * @param id - The set's id.
 * @param set - What the edit sets for it, or `undefined` to keep it as it was.
 * @returns Their ids.
 */
function markedIds(
  before: readonly Panel[],
  after: readonly Panel[],
  id: string,
  set: MarkersRequest | undefined,
): Set<string> {
  if (set === undefined) return keptPanels(before, after, id);
  if (set.panels) return namedPanels(after, id, set.panels);
  return new Set(after.filter(isTimePanel).map((panel) => panel.id));
}

/**
 * The panels with each set of markers on the charts that show it, and off every other chart. A
 * chart lists its sets in the dashboard's order.
 *
 * @param before - The panels before the edit.
 * @param after - The panels after it.
 * @param annotations - The sets after the edit.
 * @param edit - The edit's sets of markers.
 * @returns The panels.
 * @throws {QueryError} When the edit names a panel that is no time chart of the dashboard.
 */
export function placeMarkers(
  before: readonly Panel[],
  after: readonly Panel[],
  annotations: readonly Annotation[],
  edit: MarkersEdit,
): Panel[] {
  const marked = annotations.map(({ id }) => ({
    id,
    panels: markedIds(
      before,
      after,
      id,
      edit.markers.find((set) => set.id === id),
    ),
  }));
  return after.map((panel) => {
    if (panel.view.kind !== 'chart') return panel;
    const shown = marked
      .filter((set) => set.panels.has(panel.id))
      .map((set) => ({ annotation: set.id }));
    const { markers: _old, ...view } = panel.view;
    return { ...panel, view: shown.length === 0 ? view : { ...view, markers: shown } };
  });
}
