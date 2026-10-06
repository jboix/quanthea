/**
 * Which sets of markers a viewer sees. Hiding a set is a view choice kept in the URL
 * (`hide-markers=deploys`, repeated for several), like the time range and the variables: the link
 * shares the view, and the saved dashboard never changes. Panels run without it, so showing or
 * hiding a set never runs them again.
 */
import type { Annotation, DashboardSpec, MarkerColor, MarkerOutcome } from '@quanthea/shared';
import { alertSetPrefix } from './panel-alerts.ts';

/** The URL parameter that names a hidden set of markers. */
const hiddenParam = 'hide-markers';

/**
 * The sets of markers some chart of the dashboard shows, in the dashboard's order.
 *
 * @param spec - The spec.
 * @returns The sets.
 */
export function markerSetsOf(spec: DashboardSpec): Annotation[] {
  const shown = new Set(
    spec.panels.flatMap((panel) =>
      panel.view.kind === 'chart' ? (panel.view.markers ?? []).map((each) => each.annotation) : [],
    ),
  );
  return spec.annotations.filter((annotation) => shown.has(annotation.id));
}

/**
 * The sets of markers the viewer hid, the firing periods of linked alerts among them.
 *
 * @param search - The URL's search parameters.
 * @param spec - The spec, for the sets it has.
 * @returns Their ids; ids of no set are ignored.
 */
export function hiddenMarkersOf(search: URLSearchParams, spec: DashboardSpec): ReadonlySet<string> {
  const hidden = search.getAll(hiddenParam);
  const sets = new Set(spec.annotations.map(({ id }) => id));
  return new Set(hidden.filter((id) => sets.has(id) || id.startsWith(alertSetPrefix)));
}

/**
 * The URL parameters with a set of markers shown or hidden.
 *
 * @param search - The current parameters.
 * @param id - The set.
 * @param shown - Whether to show it.
 * @returns New parameters.
 */
export function withMarkersShown(
  search: URLSearchParams,
  id: string,
  shown: boolean,
): URLSearchParams {
  const next = new URLSearchParams(search);
  const hidden = next.getAll(hiddenParam).filter((each) => each !== id);
  next.delete(hiddenParam);
  for (const each of shown ? hidden : [...hidden, id]) next.append(hiddenParam, each);
  return next;
}

/**
 * The markers of a panel the viewer did not hide.
 *
 * @param markers - The panel's sets of markers.
 * @param hidden - The ids of the sets the viewer hid.
 * @returns The sets to draw.
 */
export function shownMarkers(
  markers: readonly MarkerOutcome[],
  hidden: ReadonlySet<string> | undefined,
): MarkerOutcome[] {
  return markers.filter((marker) => !hidden?.has(marker.annotation));
}

/**
 * The URL parameters the panels run with: every choice but the hidden markers, which only change
 * what the charts draw.
 *
 * @param search - The URL's search parameters.
 * @returns The parameters, as a string.
 */
export function runSearchOf(search: URLSearchParams): string {
  const next = new URLSearchParams(search);
  next.delete(hiddenParam);
  return next.toString();
}

/**
 * The stylesheet colour of a set of markers, from the same tokens the charts read.
 *
 * @param color - The set's colour token.
 * @returns A `var(…)` of a token in `@quanthea/tokens`.
 */
export function markerColorVar(color: MarkerColor | undefined): string {
  if (color === undefined || color === '@ink') return 'var(--color-ink)';
  const index = Number(color.slice('@palette.'.length));
  return index === 0 ? 'var(--color-accent)' : `var(--color-series-${index + 1})`;
}
