/**
 * Sets of markers: events such as deploys or incidents, drawn as lines on time charts, each set
 * with its id, label and colour. A set comes from a table of a SQL connector, or from a query in
 * any language that returns a time column and a text column, on any connector, whatever the
 * charts query. An edit adds or replaces sets by id and removes others; the sets it leaves out
 * stay as they were. Where each set shows is in marker-placement.ts.
 */
import { type Annotation, type MarkerColor, markerColors, slugSchema } from '@quanthea/shared';
import { type BuildContext, markersQuery, QueryError, rawData } from '../queries/index.ts';
import type { EditRequest, MarkersRequest } from './request.ts';

/** What an edit says about the sets of markers. */
export type MarkersEdit = Pick<EditRequest, 'markers' | 'removeMarkers'>;

/**
 * The annotation of one set of markers.
 *
 * @param request - The set: its id, label, and a table or a query and its columns.
 * @param color - Its colour.
 * @param context - The build context, for the connector's dialect.
 * @returns The annotation.
 * @throws {QueryError} When the query is empty.
 */
function markersAnnotation(
  request: MarkersRequest,
  color: MarkerColor,
  context: BuildContext,
): Annotation {
  const { id, label } = request;
  if (!('data' in request))
    return {
      id,
      label,
      color,
      query: markersQuery(request, context),
      timeField: 'time',
      textField: 'text',
    };
  const [query] = rawData(request.data).queries;
  if (!query) throw new QueryError(`The query of the markers "${id}" is empty.`);
  const timeField = request.time;
  const textField = request.text;
  return { id, label, color, query: { ...query, refId: 'M' }, timeField, textField };
}

/**
 * The first colour no set takes yet, so each new set reads apart from the others.
 *
 * @param annotations - The sets so far.
 * @returns The colour; the first one when every colour is taken.
 */
function freeColor(annotations: readonly Annotation[]): MarkerColor {
  const taken = new Set(annotations.map((annotation) => annotation.color ?? markerColors[0]));
  return markerColors.find((color) => !taken.has(color)) ?? markerColors[0];
}

/**
 * Checks the ids of the sets an edit sets: slugs, each once.
 *
 * @param edit - The edit's sets of markers.
 * @throws {QueryError} For an id that is no slug, or one set twice or both set and removed.
 */
function checkSetIds(edit: MarkersEdit): void {
  const ids = edit.markers.map((set) => set.id);
  const bad = ids.find((id) => !slugSchema.safeParse(id).success);
  if (bad !== undefined)
    throw new QueryError(
      `The markers id "${bad}" is no slug: use lowercase letters, digits and dashes, such as "deploys".`,
    );
  const twice = ids.find(
    (id, index) => ids.indexOf(id) !== index || edit.removeMarkers.includes(id),
  );
  if (twice !== undefined)
    throw new QueryError(`The markers "${twice}" are named twice: set or remove them once.`);
}

/**
 * Checks the edit's sets of markers against the dashboard's.
 *
 * @param annotations - The current sets.
 * @param edit - The edit's sets of markers.
 * @throws {QueryError} For a bad or repeated id, or a removed set the dashboard does not have.
 */
function checkMarkersEdit(annotations: readonly Annotation[], edit: MarkersEdit): void {
  checkSetIds(edit);
  const known = annotations.map((annotation) => annotation.id);
  const unknown = edit.removeMarkers.find((id) => !known.includes(id));
  if (unknown === undefined) return;
  const list = known.length === 0 ? 'The dashboard has none.' : `They are: ${known.join(', ')}.`;
  throw new QueryError(`No markers "${unknown}" to remove. ${list}`);
}

/**
 * The annotations after the edit: removed sets gone, sets it sets added or replaced in place, the
 * others kept. A set without a colour keeps the one it had, or takes a free one.
 *
 * @param annotations - The current annotations.
 * @param edit - The edit's sets of markers.
 * @param context - The build context, for the connector's dialect.
 * @returns The annotations.
 * @throws {QueryError} When the edit names a set wrongly, or a set cannot build.
 */
export function editedAnnotations(
  annotations: readonly Annotation[],
  edit: MarkersEdit,
  context: BuildContext,
): Annotation[] {
  checkMarkersEdit(annotations, edit);
  const result = annotations.filter((annotation) => !edit.removeMarkers.includes(annotation.id));
  for (const set of edit.markers) {
    const index = result.findIndex((annotation) => annotation.id === set.id);
    const color = set.color ?? result[index]?.color ?? freeColor(result);
    const annotation = markersAnnotation(set, color, context);
    if (index < 0) result.push(annotation);
    else result[index] = annotation;
  }
  return result;
}
