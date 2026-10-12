/**
 * Scores the shape of a panel: the data kind the agent asked for, the aggregations in its search
 * queries, its table operations and its view. Pure, like the rest of the scoring.
 */
import type { PanelQuery, View } from '@quanthea/shared';
import type { ShapeExpectation } from './questions.ts';

/** How a built panel gets its data and shows it, as the scoring reads it. */
export interface BuiltShape {
  /** Its queries; absent in reports written before they were kept. */
  readonly queries?: readonly PanelQuery[];
  /** The names of its table operations, in order; absent when it has none. */
  readonly operations?: readonly string[];
  /** The data kind the agent asked for, such as a builder's name, `raw` or `saved`. */
  readonly builder?: string;
  /** The chart recipe the agent asked for. */
  readonly recipe?: string;
  /** Its view; absent in reports written before it was kept. */
  readonly view?: View;
}

/** A built panel the shape is read from: its id, for the reasons, and its shape. */
type ShapedPanel = BuiltShape & { readonly id: string };

/** The keys of an aggregation that hold its sub-aggregations. */
const containers = ['aggs', 'aggregations'];

/**
 * Whether a value is a JSON object.
 *
 * @param value - The value.
 * @returns True for an object that is not an array.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The field an aggregation reads: its name, or `$name` when a variable gives it.
 *
 * @param settings - The aggregation's settings.
 * @returns The field, if it names one.
 */
function fieldOf(settings: unknown): string | undefined {
  if (!isRecord(settings)) return undefined;
  const { field } = settings;
  if (typeof field === 'string') return field;
  return isRecord(field) && typeof field.$var === 'string' ? `$${field.$var}` : undefined;
}

/**
 * The aggregations of a composite's sources, each a named aggregation.
 *
 * @param settings - The aggregation's settings.
 * @returns Their names; none when it has no sources.
 */
function sourcesOf(settings: unknown): string[] {
  if (!isRecord(settings) || !Array.isArray(settings.sources)) return [];
  return settings.sources.flatMap(namedIn);
}

/**
 * The names of one aggregation and of those under it: its type, and its type with its field.
 *
 * @param aggregation - The aggregation, such as `{ terms: { field }, aggs: { ... } }`.
 * @returns The names, such as `terms` and `terms:event_name`.
 */
function namesOf(aggregation: unknown): string[] {
  if (!isRecord(aggregation)) return [];
  return Object.entries(aggregation).flatMap(([key, settings]) => {
    if (containers.includes(key)) return namedIn(settings);
    if (key === 'meta') return [];
    const field = fieldOf(settings);
    const own = field === undefined ? [key] : [key, `${key}:${field}`];
    return [...own, ...sourcesOf(settings)];
  });
}

/**
 * The names of the aggregations in a map of named aggregations.
 *
 * @param named - The map, such as the value of `aggs`.
 * @returns The names.
 */
function namedIn(named: unknown): string[] {
  return isRecord(named) ? Object.values(named).flatMap(namesOf) : [];
}

/**
 * The aggregations of a search query, at every depth: each type, and each type with its field.
 *
 * @param query - The query.
 * @returns The names, such as `date_histogram` and `terms:event_name`; none for another language.
 */
export function aggregationsOf(query: PanelQuery): string[] {
  if (query.language !== 'search') return [];
  return containers.flatMap((key) => namedIn(query.body[key]));
}

/**
 * An aggregation's name, for a reason.
 *
 * @param name - The name, such as `terms:event_name`.
 * @returns The words, such as "terms on event_name".
 */
function aggregationWords(name: string): string {
  const [type = name, ...field] = name.split(':');
  return field.length === 0 ? type : `${type} on ${field.join(':')}`;
}

/**
 * Whether the wanted names come in the given ones, in order; others may sit between them.
 *
 * @param given - The names the panel has.
 * @param wanted - The names expected.
 * @returns True when they do.
 */
function inOrder(given: readonly string[], wanted: readonly string[]): boolean {
  let next = 0;
  for (const name of given) if (name === wanted[next]) next += 1;
  return next === wanted.length;
}

/**
 * Why the data kind asked is not the one expected.
 *
 * @param panel - The panel.
 * @param builder - The data kind expected, if any.
 * @returns The reason, if any.
 */
function builderFaults(panel: BuiltShape, builder: string | undefined): string[] {
  if (builder === undefined || panel.builder === builder) return [];
  return [`data asked as ${panel.builder ?? 'nothing on record'}, not ${builder}`];
}

/**
 * The aggregations expected that no query of the panel has.
 *
 * @param panel - The panel.
 * @param wanted - The aggregations expected.
 * @returns The reasons.
 */
function aggregationFaults(panel: BuiltShape, wanted: readonly string[]): string[] {
  const found = new Set((panel.queries ?? []).flatMap(aggregationsOf));
  return wanted
    .filter((name) => !found.has(name))
    .map((name) => `no ${aggregationWords(name)} in the query`);
}

/**
 * Why the operations of the panel are not the ones expected.
 *
 * @param panel - The panel.
 * @param wanted - The names expected, in order.
 * @returns The reason, if any.
 */
function operationFaults(panel: BuiltShape, wanted: readonly string[]): string[] {
  const operations = panel.operations ?? [];
  if (inOrder(operations, wanted)) return [];
  return [`operations ${operations.join(', ') || 'none'}, not ${wanted.join(', ')}`];
}

/**
 * What the data of a panel misses: the data kind asked, aggregations, and operations.
 *
 * @param panel - The panel.
 * @param expect - The shape expected.
 * @returns The reasons.
 */
function dataFaults(panel: BuiltShape, expect: ShapeExpectation): string[] {
  return [
    ...builderFaults(panel, expect.builder),
    ...aggregationFaults(panel, expect.aggregations ?? []),
    ...operationFaults(panel, expect.operations ?? []),
  ];
}

/**
 * Whether a value holds what is left of a path. A list holds it when one of its items does.
 *
 * @param value - The value reached so far.
 * @param keys - The keys still to follow.
 * @param wanted - The text the value there must read as, if the path names one.
 * @returns True when the value there is defined, or reads as the text wanted.
 */
function holds(value: unknown, keys: readonly string[], wanted: string | undefined): boolean {
  if (Array.isArray(value) && (keys.length > 0 || wanted !== undefined))
    return value.some((item) => holds(item, keys, wanted));
  const [key, ...rest] = keys;
  if (key !== undefined) return isRecord(value) && holds(value[key], rest, wanted);
  if (wanted !== undefined) return String(value) === wanted;
  return value !== undefined && value !== null;
}

/**
 * Whether a view, or another part of a spec, holds a field. The path has dots between the keys of
 * nested objects, such as `sort.field`. A key under a list is looked for in each of its items, so
 * `columns.mappings` holds when one column has mappings. With `=`, the value must read as the text
 * after it, such as `layout=record`.
 *
 * @param value - The view, or the part of the spec.
 * @param path - The field, and after `=` the value it must have, if any.
 * @returns True when the value there is defined, or reads as the text given.
 */
export function holdsField(value: unknown, path: string): boolean {
  const [keys = '', wanted] = path.split('=');
  return holds(value, keys.split('.'), wanted);
}

/**
 * The recipe of a panel: the one its chart records, else the one the agent asked for.
 *
 * @param panel - The panel.
 * @returns The recipe's id, if either is known.
 */
function recipeOf(panel: BuiltShape): string | undefined {
  const recorded = panel.view?.kind === 'chart' ? panel.view.recipe?.id : undefined;
  return recorded ?? panel.recipe;
}

/**
 * Why the recipe of the panel is not the one expected.
 *
 * @param panel - The panel.
 * @param wanted - The recipe expected, if any.
 * @returns The reason, if any.
 */
function recipeFaults(panel: BuiltShape, wanted: string | undefined): string[] {
  const recipe = recipeOf(panel);
  if (wanted === undefined || recipe === wanted) return [];
  return [`recipe ${recipe ?? 'not on record'}, not ${wanted}`];
}

/**
 * What the view of a panel misses: its kind, its recipe, and the fields it must hold.
 *
 * @param panel - The panel.
 * @param expect - The view expected, if any.
 * @returns The reasons.
 */
function viewFaults(panel: BuiltShape, expect: ShapeExpectation['view']): string[] {
  if (!expect) return [];
  const { view } = panel;
  if (!view) return ['no view on record'];
  const kind = view.kind === expect.kind ? [] : [`a ${view.kind} view, not a ${expect.kind}`];
  const fields = (expect.has ?? [])
    .filter((path) => !holdsField(view, path))
    .map((path) => `the view has no ${path}`);
  return [...kind, ...recipeFaults(panel, expect.recipe), ...fields];
}

/**
 * What the shape misses, read on the panel that comes closest to it: an answer has the shape when
 * one of its panels has all of it.
 *
 * @param panels - The panels built.
 * @param expect - The shape expected.
 * @returns The reasons, each starting with the panel's id; none when a panel has the shape.
 */
export function shapeFaults(panels: readonly ShapedPanel[], expect: ShapeExpectation): string[] {
  let closest: string[] | undefined;
  for (const panel of panels) {
    const reasons = [...dataFaults(panel, expect), ...viewFaults(panel, expect.view)];
    if (closest === undefined || reasons.length < closest.length)
      closest = reasons.map((reason) => `${panel.id}: ${reason}`);
  }
  return closest ?? [];
}
