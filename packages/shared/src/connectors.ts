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

/**
 * Validates the names a connector's list holds: an index, table, collection, metric or endpoint as
 * the schema lists it, or a pattern where `*` stands for any run of characters, such as `logs-*`.
 */
export const objectNamesSchema = z.array(z.string().trim().min(1).max(200)).max(maxObjectNames);

/** How a connector's list of names reads: everything but them, or nothing but them. */
export const objectListModes = ['except', 'only'] as const;

/**
 * Validates which objects of a source a connector shows. `showSystem` shows the source's own
 * objects, hidden otherwise. `names` are hidden when `mode` is `except` and the only ones shown
 * when it is `only`.
 */
export const objectVisibilitySchema = z.object({
  showSystem: z.boolean().default(false),
  mode: z.enum(objectListModes).default('except'),
  names: objectNamesSchema.default([]),
});

/** Which objects of a source a connector shows. */
export type ObjectVisibility = z.output<typeof objectVisibilitySchema>;

/** The visibility of a new connector: everything but the source's own objects. */
export const defaultObjectVisibility: ObjectVisibility = {
  showSystem: false,
  mode: 'except',
  names: [],
};

/**
 * Where a name's text stands after the middle parts of a pattern, each found in turn.
 *
 * @param text - The name, in lower case.
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
 * Whether a pattern covers a name. `*` stands for any run of characters, dots included, and names
 * compare without case.
 *
 * @param pattern - A name or a pattern, such as `logs-*`.
 * @param name - The name of an object.
 * @returns `true` when the pattern covers the whole name.
 */
export function matchesObjectName(pattern: string, name: string): boolean {
  const [first = '', ...rest] = pattern.trim().toLowerCase().split('*');
  const text = name.toLowerCase();
  if (rest.length === 0) return first === text;
  if (!text.startsWith(first)) return false;
  const last = rest.pop() ?? '';
  const from = afterParts(text, rest, first.length);
  return from !== undefined && text.length - last.length >= from && text.endsWith(last);
}

/**
 * Whether a connector's list lets a name through, system objects aside: not on an `except` list,
 * or on an `only` list.
 *
 * @param visibility - The connector's list and how it reads.
 * @param name - The name of an object.
 * @returns `true` when the list does not hide the name.
 */
export function listShowsObject(
  visibility: { readonly mode: ObjectVisibility['mode']; readonly names: readonly string[] },
  name: string,
): boolean {
  const listed = visibility.names.some((pattern) => matchesObjectName(pattern, name));
  return visibility.mode === 'only' ? listed : !listed;
}
