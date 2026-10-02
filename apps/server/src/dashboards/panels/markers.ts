/**
 * Deploy markers: events such as deploys, drawn as lines on time charts. They come from a table of
 * a SQL connector, or from a query in any language that returns a time column and a text column,
 * on any connector, whatever the charts query. They go on every time chart, or on the panels the
 * edit names; an edit that leaves them out keeps them where they were.
 */
import type { Annotation, Panel } from '@quanthea/shared';
import { type BuildContext, markersQuery, QueryError, rawData } from '../queries/index.ts';
import { isTimeChart } from './expand.ts';
import type { EditRequest, MarkersRequest } from './request.ts';

/** The id of the markers' annotation. */
export const markersId = 'markers';

/**
 * The markers' annotation.
 *
 * @param request - The markers request: a table, or a query and its columns.
 * @param context - The build context, for the connector's dialect.
 * @returns The annotation.
 */
function markersAnnotation(request: MarkersRequest, context: BuildContext): Annotation {
  if (!('data' in request))
    return {
      id: markersId,
      label: request.label,
      query: markersQuery(request, context),
      timeField: 'time',
      textField: 'text',
    };
  const [query] = rawData(request.data).queries;
  if (!query) throw new QueryError('The markers query is empty.');
  return {
    id: markersId,
    label: request.label,
    query: { ...query, refId: 'M' },
    timeField: request.time,
    textField: request.text,
  };
}

/**
 * The annotations after the edit: the markers set, removed, or kept as they were.
 *
 * @param annotations - The current annotations.
 * @param markers - The edit's markers: a request, `null` to remove, `undefined` to keep.
 * @param context - The build context, for the connector's dialect.
 * @returns The annotations.
 */
export function editedAnnotations(
  annotations: readonly Annotation[],
  markers: EditRequest['markers'],
  context: BuildContext,
): Annotation[] {
  if (markers === undefined) return [...annotations];
  const others = annotations.filter((annotation) => annotation.id !== markersId);
  return markers === null ? others : [...others, markersAnnotation(markers, context)];
}

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
 * Whether a panel shows the markers.
 *
 * @param panel - The panel.
 * @returns Whether its chart names the markers' annotation.
 */
function showsMarkers(panel: Panel): boolean {
  return (
    panel.view.kind === 'chart' &&
    (panel.view.markers ?? []).some((marker) => marker.annotation === markersId)
  );
}

/**
 * The panels an edit names for the markers, by id or title.
 *
 * @param panels - The panels after the edit.
 * @param names - Their ids or titles.
 * @returns Their ids.
 * @throws {QueryError} When a name is no panel, or a panel is not a time chart.
 */
function namedPanels(panels: readonly Panel[], names: readonly string[]): Set<string> {
  const keyOf = (text: string) => text.trim().toLowerCase();
  return new Set(
    names.map((name) => {
      const panel = panels.find((each) => each.id === name || keyOf(each.title) === keyOf(name));
      if (!panel)
        throw new QueryError(
          `No panel "${name}" to show the markers. The panels are: ${panels.map((each) => each.id).join(', ')}.`,
        );
      if (!isTimePanel(panel))
        throw new QueryError(`Markers go on time charts, and "${panel.title}" is not one.`);
      return panel.id;
    }),
  );
}

/**
 * The panels that keep showing markers the edit leaves as they were: those that showed them, and
 * new time charts when every time chart showed them.
 *
 * @param before - The panels before the edit.
 * @param after - The panels after it.
 * @returns Their ids.
 */
function keptPanels(before: readonly Panel[], after: readonly Panel[]): Set<string> {
  const charts = before.filter(isTimePanel);
  const everyChart = charts.length > 0 && charts.every(showsMarkers);
  const known = new Set(before.map((panel) => panel.id));
  const fresh = everyChart
    ? after.filter((panel) => !known.has(panel.id) && isTimePanel(panel))
    : [];
  return new Set([...before.filter(showsMarkers), ...fresh].map((panel) => panel.id));
}

/**
 * The panels that show the markers after the edit.
 *
 * @param before - The panels before the edit.
 * @param after - The panels after it.
 * @param markers - The edit's markers: a request, `null` to remove, `undefined` to keep.
 * @returns Their ids.
 */
function markedIds(
  before: readonly Panel[],
  after: readonly Panel[],
  markers: EditRequest['markers'],
): Set<string> {
  if (markers === null) return new Set();
  if (markers === undefined) return keptPanels(before, after);
  if (markers.panels) return namedPanels(after, markers.panels);
  return new Set(after.filter(isTimePanel).map((panel) => panel.id));
}

/**
 * The panels with the markers on the charts that show them, and off every other chart.
 *
 * @param before - The panels before the edit.
 * @param after - The panels after it.
 * @param markers - The edit's markers: a request, `null` to remove, `undefined` to keep.
 * @returns The panels.
 * @throws {QueryError} When the edit names a panel that is no time chart of the dashboard.
 */
export function placeMarkers(
  before: readonly Panel[],
  after: readonly Panel[],
  markers: EditRequest['markers'],
): Panel[] {
  const marked = markedIds(before, after, markers);
  return after.map((panel) => {
    if (panel.view.kind !== 'chart') return panel;
    const others = (panel.view.markers ?? []).filter((marker) => marker.annotation !== markersId);
    const shown = marked.has(panel.id) ? [...others, { annotation: markersId }] : others;
    const { markers: _old, ...view } = panel.view;
    return { ...panel, view: shown.length === 0 ? view : { ...view, markers: shown } };
  });
}
