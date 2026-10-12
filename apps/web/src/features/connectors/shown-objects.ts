/**
 * What a connector shows of its source, as the form edits it: the checklist over the objects the
 * schema found, the list of names and patterns behind it, and the counts. Whether the list covers
 * a name is the server's rule (`coveringEntry` in `@quanthea/shared`), read with the naming the
 * schema view gives for the source, so the checklist ticks what a query may read.
 */
import {
  coveringEntry,
  foldedNaming,
  listShowsObject,
  type ObjectNaming,
  type ObjectUsage,
  type ObjectVisibility,
  type SchemaView,
  wholeObjectVisibilitySchema,
} from '@quanthea/shared';
import { wordMatcher } from '../../ui/suggest-items.ts';

/** One object of a schema view: an index, a table, a collection, a metric or an endpoint. */
export type SchemaObject = SchemaView['entities'][number];

/** The plural noun for a schema's objects, by kind. */
const objectNouns: Readonly<Record<SchemaObject['kind'], string>> = {
  table: 'tables',
  view: 'tables',
  metric: 'metrics',
  index: 'indices',
  endpoint: 'endpoints',
  collection: 'collections',
};

/** The query languages whose sources keep objects of their own, hidden unless shown. */
const systemLanguages: ReadonlySet<string> = new Set(['sql', 'search', 'mongodb']);

/**
 * Whether sources of a query language have objects of their own, so the switch that shows them
 * means something.
 *
 * @param language - The query language of the connector's kind.
 * @returns `true` for SQL, search and MongoDB.
 */
export function hasSystemObjects(language: string | undefined): boolean {
  return language !== undefined && systemLanguages.has(language);
}

/**
 * What to call the objects of a schema.
 *
 * @param objects - The objects.
 * @returns Such as `tables` or `indices`; `objects` when they are of several kinds or none.
 */
export function objectsNoun(objects: readonly SchemaObject[]): string {
  const nouns = new Set(objects.map((object) => objectNouns[object.kind]));
  const [noun] = nouns;
  return nouns.size === 1 && noun !== undefined ? noun : 'objects';
}

/**
 * Whether two names are the same to a source: without case, unless it tells names apart by it.
 *
 * @param first - One name.
 * @param second - The other.
 * @param naming - How the source names its objects.
 * @returns `true` when they name the same object.
 */
function sameName(first: string, second: string, naming: ObjectNaming): boolean {
  const [one, other] = [first.trim(), second.trim()];
  return naming.exactCase ? one === other : one.toLowerCase() === other.toLowerCase();
}

/**
 * Whether an entry is a pattern and not one name.
 *
 * @param entry - A name or a pattern.
 * @returns `true` when it holds a `*`.
 */
export function isPattern(entry: string): boolean {
  return entry.includes('*');
}

/**
 * Whether a visibility shows an object, as the server decides it: a system object needs the
 * switch, and the list hides its names or shows nothing else.
 *
 * @param visibility - The visibility.
 * @param object - The object.
 * @param naming - How the source names its objects.
 * @returns `true` when the connector would show it.
 */
export function isShown(
  visibility: ObjectVisibility,
  object: SchemaObject,
  naming: ObjectNaming = foldedNaming,
): boolean {
  if (object.system && !visibility.showSystem) return false;
  return listShowsObject(visibility, object.name, naming);
}

/** Why an object's checkbox cannot be changed. */
export type Lock =
  | {
      /** The object is the source's own and the switch is off. */
      readonly by: 'system';
    }
  | {
      /** A pattern decides for it. */
      readonly by: 'pattern';
      /** The pattern. */
      readonly pattern: string;
    };

/**
 * Why an object's checkbox cannot be changed, if it cannot: the switch hides it, or an entry of
 * the list that is not its own name covers it, and a list has no way to except one name from
 * such an entry. That entry is a pattern, or for a table a hidden name that covers it in every
 * schema, such as `salaries` for `hr.salaries`.
 *
 * @param visibility - The visibility.
 * @param object - The object.
 * @param naming - How the source names its objects.
 * @returns The lock, or `undefined` when the checkbox is free.
 */
export function lockOf(
  visibility: ObjectVisibility,
  object: SchemaObject,
  naming: ObjectNaming = foldedNaming,
): Lock | undefined {
  if (object.system && !visibility.showSystem) return { by: 'system' };
  const entry = coveringEntry(visibility, object.name, naming);
  if (entry === undefined || sameName(entry, object.name, naming)) return undefined;
  return { by: 'pattern', pattern: entry };
}

/**
 * A list with a name added, unless an entry is the same already. Names compare as the source
 * compares them.
 *
 * @param names - The list.
 * @param name - The name or pattern to add.
 * @param naming - How the source names its objects.
 * @returns The new list, or the same one.
 */
export function withName(
  names: readonly string[],
  name: string,
  naming: ObjectNaming = foldedNaming,
): readonly string[] {
  const added = name.trim();
  if (added === '' || names.some((entry) => sameName(entry, added, naming))) return names;
  return [...names, added];
}

/**
 * A list without a name. Names compare as the source compares them.
 *
 * @param names - The list.
 * @param name - The name or pattern to remove.
 * @param naming - How the source names its objects.
 * @returns The new list.
 */
export function withoutName(
  names: readonly string[],
  name: string,
  naming: ObjectNaming = foldedNaming,
): readonly string[] {
  return names.filter((entry) => !sameName(entry, name, naming));
}

/**
 * A visibility with one object ticked or cleared in the checklist. Ticked means shown: on a list
 * of hidden names the name leaves the list, on a list of the only names shown it joins it.
 *
 * @param visibility - The visibility.
 * @param name - The object's name.
 * @param shown - Whether it is ticked now.
 * @param naming - How the source names its objects.
 * @returns The new visibility.
 */
export function withObject(
  visibility: ObjectVisibility,
  name: string,
  shown: boolean,
  naming: ObjectNaming = foldedNaming,
): ObjectVisibility {
  const listed = shown === (visibility.mode === 'only');
  const edit = listed ? withName : withoutName;
  return { ...visibility, names: [...edit(visibility.names, name, naming)] };
}

/**
 * A visibility with several objects ticked or cleared at once.
 *
 * @param visibility - The visibility.
 * @param names - The objects' names.
 * @param shown - Whether they are ticked now.
 * @param naming - How the source names its objects.
 * @returns The new visibility.
 */
export function withObjects(
  visibility: ObjectVisibility,
  names: readonly string[],
  shown: boolean,
  naming: ObjectNaming = foldedNaming,
): ObjectVisibility {
  return names.reduce((next, name) => withObject(next, name, shown, naming), visibility);
}

/** How a list reads a name: the way the list reads, and how the source names its objects. */
export interface ListReading {
  /** Whether the list holds the hidden names or the only names shown. */
  readonly mode: ObjectVisibility['mode'];
  /** How the source names its objects; plain names without case when left out. */
  readonly naming?: ObjectNaming | undefined;
}

/**
 * How many objects an entry of the list covers, as the server reads it.
 *
 * @param entry - A name or a pattern.
 * @param objects - The schema's objects.
 * @param reading - How the list reads; a list of hidden plain names when left out.
 * @returns The number of objects it covers.
 */
export function matchCount(
  entry: string,
  objects: readonly SchemaObject[],
  reading: ListReading = { mode: 'except' },
): number {
  const list = { mode: reading.mode, names: [entry] };
  const naming = reading.naming ?? foldedNaming;
  return objects.filter((object) => coveringEntry(list, object.name, naming) !== undefined).length;
}

/**
 * The entries of a list the checklist cannot show as a tick: the patterns, and the names that are
 * not the name of an object of the schema.
 *
 * @param names - The list.
 * @param objects - The schema's objects.
 * @param naming - How the source names its objects.
 * @returns The entries, in the list's order.
 */
export function looseEntries(
  names: readonly string[],
  objects: readonly SchemaObject[],
  naming: ObjectNaming = foldedNaming,
): string[] {
  const named = (entry: string) => objects.some((object) => sameName(object.name, entry, naming));
  return names.filter((entry) => isPattern(entry) || !named(entry));
}

/**
 * The line that counts what a visibility shows of a schema.
 *
 * @param visibility - The visibility.
 * @param objects - The schema's objects.
 * @param naming - How the source names its objects.
 * @returns Such as `Shows 12 of 40 indices · 6 system hidden`.
 */
export function shownSummary(
  visibility: ObjectVisibility,
  objects: readonly SchemaObject[],
  naming: ObjectNaming = foldedNaming,
): string {
  const shown = objects.filter((object) => isShown(visibility, object, naming)).length;
  const system = visibility.showSystem ? 0 : objects.filter((object) => object.system).length;
  const line = `Shows ${shown.toLocaleString('en')} of ${objects.length.toLocaleString('en')} ${objectsNoun(objects)}`;
  return system === 0 ? line : `${line} · ${system.toLocaleString('en')} system hidden`;
}

/**
 * Whether two visibilities are the same setting. The order of the names does not count.
 *
 * @param first - One visibility.
 * @param second - The other.
 * @returns `true` when saving one over the other changes nothing.
 */
export function sameVisibility(first: ObjectVisibility, second: ObjectVisibility): boolean {
  if (first.showSystem !== second.showSystem || first.mode !== second.mode) return false;
  const sorted = (names: readonly string[]) => [...names].sort().join('\n');
  return sorted(first.names) === sorted(second.names);
}

/**
 * The objects a filter keeps: every typed word is somewhere in the name, in any case.
 *
 * @param objects - The schema's objects.
 * @param filter - The text typed.
 * @returns The matching objects, in the schema's order.
 */
export function filteredObjects(
  objects: readonly SchemaObject[],
  filter: string,
): readonly SchemaObject[] {
  const matches = wordMatcher(filter);
  return objects.filter((object) => matches(object.name));
}

/**
 * The resource route that counts the dashboards reading an object a visibility hides.
 *
 * @param connectorId - The connector.
 * @param visibility - The visibility about to be saved.
 * @returns The path, with the visibility in its query.
 */
export function objectUsagePath(connectorId: string, visibility: ObjectVisibility): string {
  const search = new URLSearchParams({
    system: visibility.showSystem ? '1' : '0',
    mode: visibility.mode,
  });
  for (const name of visibility.names) search.append('name', name);
  return `/connectors/${connectorId}/object-usage?${search.toString()}`;
}

/**
 * Reads a visibility back from the query of {@link objectUsagePath}.
 *
 * @param search - The query.
 * @returns The visibility, or `undefined` when the query holds none.
 */
export function visibilityOf(search: URLSearchParams): ObjectVisibility | undefined {
  if (!search.has('mode')) return undefined;
  return wholeObjectVisibilitySchema.safeParse({
    showSystem: search.get('system') === '1',
    mode: search.get('mode'),
    names: search.getAll('name'),
  }).data;
}

/**
 * Counts things in words, with the verb that agrees.
 *
 * @param count - How many.
 * @param noun - The singular noun.
 * @returns Such as `1 thread` or `3 threads`.
 */
function counted(count: number, noun: string): string {
  return `${count.toLocaleString('en')} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * The warning shown before saving a visibility that hides an object dashboards read.
 *
 * @param usage - How many threads and pinned dashboards read one.
 * @returns The warning.
 */
export function objectUsageWarning(usage: ObjectUsage): string {
  const parts = [
    ...(usage.threads > 0 ? [counted(usage.threads, 'thread')] : []),
    ...(usage.pinned > 0 ? [counted(usage.pinned, 'pinned dashboard')] : []),
  ];
  const verb = usage.threads + usage.pinned === 1 ? 'reads' : 'read';
  return `${parts.join(' and ')} ${verb} an object this change hides. Their queries on it are refused from now on, and a search pattern runs without it, until a new version reads something else.`;
}

/**
 * The warning shown before saving a visibility when the dashboards it affects could not be
 * counted.
 *
 * @param failure - Why they could not be counted.
 * @returns The warning.
 */
export function uncountedUsageWarning(failure: string): string {
  const reason = failure.trim().replace(/\.$/, '');
  return `The dashboards this change affects could not be counted: ${reason}. Threads and pinned dashboards may read an object it hides, and their queries on it are refused from now on.`;
}
