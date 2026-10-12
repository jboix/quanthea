/** The settings every connector has, whatever its kind: name, access level, hidden fields, guardrails. */
import { z } from 'zod';

/**
 * Validates a connector name: lowercase letters, digits and dashes, as dashboard specs refer to it
 * (`"connector": "postgres-orders"`).
 */
export const connectorNameSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9-]{0,62}$/,
    'Use lowercase letters, digits and dashes, up to 63 characters.',
  );

/**
 * Validates an access level: what the model may see of a connector's data.
 * 1 schema only, 2 schema and metadata, 3 aggregates, 4 full access.
 */
export const accessLevelSchema = z.literal([1, 2, 3, 4]);

/** An access level. */
export type AccessLevel = z.infer<typeof accessLevelSchema>;

/** The access level of a new connector: schema and metadata. */
export const defaultAccessLevel: AccessLevel = 2;

/**
 * Fields with at most this many distinct values are low cardinality: from level 2 the model gets
 * their values.
 */
export const lowCardinalityLimit = 50;

/**
 * Validates the fields removed from everything the model receives, at every access level:
 * `entity.field` (such as `customers.email`), or a bare `field` for every entity.
 */
export const hiddenFieldsSchema = z.array(z.string().trim().min(1).max(200)).max(500);

/** Validates the limits the server enforces on every query of a connector. */
export const guardrailsSchema = z.object({
  timeoutMs: z
    .int({ error: 'Use a number.' })
    .min(1000, 'At least 1 second.')
    .max(300_000, 'At most 300 seconds.')
    .default(10_000),
  maxRows: z
    .int({ error: 'Use a whole number.' })
    .min(1, 'At least 1 row.')
    .max(1_000_000, 'At most 1,000,000 rows.')
    .default(50_000),
  maxRangeDays: z
    .int({ error: 'Use a whole number.' })
    .min(1, 'At least 1 day.')
    .max(3650, 'At most 3650 days.')
    .default(90),
});

/** The limits the server enforces on every query of a connector. */
export type Guardrails = z.output<typeof guardrailsSchema>;

/** Validates admin-written descriptions, keyed by `entity` or `entity.field`. */
export const descriptionsSchema = z.record(z.string().min(1).max(200), z.string().max(2000));

/** The most names and patterns a connector's list holds. */
export const maxObjectNames = 500;

/** Validates one name or pattern of a connector's list. */
const objectNameSchema = z.string().trim().min(1).max(200);

/**
 * Validates the names a connector's list holds: an index, table, collection, metric or endpoint as
 * the schema lists it, or a pattern where `*` stands for any run of characters, such as `logs-*`.
 */
export const objectNamesSchema = z.array(objectNameSchema).max(maxObjectNames);

/** How a connector's list of names reads: everything but them, or nothing but them. */
export const objectListModes = ['except', 'only'] as const;

/**
 * Validates which objects of a source a connector shows. `showSystem` shows the source's own
 * objects, hidden otherwise. `names` are hidden when `mode` is `except` and the only ones shown
 * when it is `only`. A key it does not know is refused, so a misspelt `names` is not read as an
 * empty list.
 */
export const objectVisibilitySchema = z.strictObject({
  showSystem: z.boolean().default(false),
  mode: z.enum(objectListModes).default('except'),
  names: objectNamesSchema.default([]),
});

/** Which objects of a source a connector shows. */
export type ObjectVisibility = z.output<typeof objectVisibilitySchema>;

/** What a visibility that leaves a key out is told. */
const wholeVisibility =
  'A visibility is replaced whole: give showSystem, mode and names, as the connector holds them.';

/**
 * The message of a key of a whole visibility: the reminder when the key is missing, the usual
 * message otherwise.
 *
 * @param issue - The issue raised.
 * @param issue.input - The value given for the key.
 * @returns The reminder, or `undefined` for the usual message.
 */
function missingKey(issue: { readonly input?: unknown }): string | undefined {
  return issue.input === undefined ? wholeVisibility : undefined;
}

/**
 * Validates a visibility that replaces a stored one: every key is given. Defaults would fill a
 * partial one, and `{ showSystem: true }` alone would empty the list and show everything.
 */
export const wholeObjectVisibilitySchema = z.strictObject({
  showSystem: z.boolean({ error: missingKey }),
  mode: z.enum(objectListModes, { error: missingKey }),
  names: z.array(objectNameSchema, { error: missingKey }).max(maxObjectNames),
});

/** The visibility of a new connector: everything but the source's own objects. */
export const defaultObjectVisibility: ObjectVisibility = {
  showSystem: false,
  mode: 'except',
  names: [],
};

/** Validates how a source names its objects, which decides how a connector's list reads them. */
export const objectNamingSchema = z.object({
  /** Whether names compare with case: `Orders` and `orders` are two objects. */
  exactCase: z.boolean(),
  /** Whether a name is a path of dotted parts, a table in its schema, as SQL writes it. */
  qualified: z.boolean(),
  /** The schema a bare name stands in, which the source's catalogue leaves out, if it has one. */
  defaultSchema: z.string().optional(),
});

/** How a source names its objects. */
export type ObjectNaming = z.infer<typeof objectNamingSchema>;

/** The naming of a source with plain names that compare without case, such as a search server. */
export const foldedNaming: ObjectNaming = { exactCase: false, qualified: false };

/**
 * Where a name's text stands after the middle parts of a pattern, each found in turn.
 *
 * @param text - The name.
 * @param parts - The parts between the pattern's stars.
 * @param start - Where to look from.
 * @returns The index after the last part, or `undefined` when a part is missing.
 */
function afterParts(text: string, parts: readonly string[], start: number): number | undefined {
  let from = start;
  for (const part of parts) {
    const found = text.indexOf(part, from);
    if (found === -1) return undefined;
    from = found + part.length;
  }
  return from;
}

/**
 * Whether a pattern covers a name. `*` stands for any run of characters, dots included. Names
 * compare without case unless the source tells them apart by it.
 *
 * @param pattern - A name or a pattern, such as `logs-*`.
 * @param name - The name of an object.
 * @param exactCase - Whether names compare with case.
 * @returns `true` when the pattern covers the whole name.
 */
export function matchesObjectName(pattern: string, name: string, exactCase = false): boolean {
  const cased = (value: string) => (exactCase ? value : value.toLowerCase());
  const [first = '', ...rest] = cased(pattern.trim()).split('*');
  const text = cased(name);
  if (rest.length === 0) return first === text;
  if (!text.startsWith(first)) return false;
  const last = rest.pop() ?? '';
  const from = afterParts(text, rest, first.length);
  return from !== undefined && text.length - last.length >= from && text.endsWith(last);
}

/**
 * The names a listed entry may cover for an object to count as listed. A plain name is itself. A
 * qualified name on a list of hidden names is each of its endings, `orders` for `shop.orders`: a
 * hidden name hides the table in every schema, since a query's bare name does not say which one
 * it reads. On a list of the only names shown it is the name as written, and without the default
 * schema.
 *
 * @param mode - How the list reads.
 * @param name - The object's name.
 * @param naming - How the source names its objects.
 * @returns The names, the whole one first.
 */
function listedForms(mode: ObjectVisibility['mode'], name: string, naming: ObjectNaming): string[] {
  if (!naming.qualified) return [name];
  const parts = name.split('.');
  if (mode === 'except') return parts.map((_part, index) => parts.slice(index).join('.'));
  const [schema = '', table = ''] = parts;
  const bare = parts.length === 2 && schema.toLowerCase() === naming.defaultSchema?.toLowerCase();
  return bare ? [name, table] : [name];
}

/**
 * The entry of a connector's list that decides for a name: the first that covers it, read as the
 * source names its objects.
 *
 * @param visibility - The connector's list and how it reads.
 * @param name - The name of an object, as the schema lists it or a query writes it.
 * @param naming - How the source names its objects; plain names without case when left out.
 * @returns The entry, or `undefined` when none covers the name.
 */
export function coveringEntry(
  visibility: { readonly mode: ObjectVisibility['mode']; readonly names: readonly string[] },
  name: string,
  naming: ObjectNaming = foldedNaming,
): string | undefined {
  const forms = listedForms(visibility.mode, name, naming);
  return visibility.names.find((entry) =>
    forms.some((form) => matchesObjectName(entry, form, naming.exactCase)),
  );
}

/**
 * Whether a connector's list lets a name through, system objects aside: not on an `except` list,
 * or on an `only` list. The catalogue, the checklist and a query's check all read this one answer.
 *
 * @param visibility - The connector's list and how it reads.
 * @param name - The name of an object.
 * @param naming - How the source names its objects; plain names without case when left out.
 * @returns `true` when the list does not hide the name.
 */
export function listShowsObject(
  visibility: { readonly mode: ObjectVisibility['mode']; readonly names: readonly string[] },
  name: string,
  naming: ObjectNaming = foldedNaming,
): boolean {
  const listed = coveringEntry(visibility, name, naming) !== undefined;
  return visibility.mode === 'only' ? listed : !listed;
}
