/** The names the hidden fields list suggests, and whether a hidden name is one the schema has. */
import type { SchemaView } from '@quanthea/shared';

/**
 * Every field of a schema, as `entity.field`.
 *
 * @param schema - The schema.
 * @returns The names, in the schema's order.
 */
function fieldPaths(schema: SchemaView): string[] {
  return schema.entities.flatMap((entity) =>
    entity.fields.map((field) => `${entity.name}.${field.name}`),
  );
}

/**
 * The fields of a schema that are not on the hidden list yet.
 *
 * @param schema - The schema.
 * @param hidden - The hidden names.
 * @returns `entity.field` names, to suggest.
 */
export function hideableFields(schema: SchemaView, hidden: readonly string[]): string[] {
  return fieldPaths(schema).filter((name) => !hidden.includes(name));
}

/**
 * Whether a name matches a path as the server matches hidden names: it is the path, an object or
 * entity the path lies under, or the name the path ends with. Both are in lower case.
 *
 * @param name - The hidden name.
 * @param path - A field's path, with its entity or without.
 * @returns `true` when hiding the name hides the path.
 */
function covers(name: string, path: string): boolean {
  return path === name || path.startsWith(`${name}.`) || path.endsWith(`.${name}`);
}

/**
 * Tells the hidden names the schema has from the ones it lacks. A name is in the schema when it
 * hides at least one of its fields: an `entity.field`, a bare `field` of any entity, or an object
 * or entity that holds fields. Names compare without case, as the server compares them.
 *
 * @param schema - The schema.
 * @returns The test of one name. It passes every name while the schema is empty, since nothing
 *   can be told then.
 */
export function schemaNames(schema: SchemaView): (name: string) => boolean {
  const paths = schema.entities.flatMap((entity) =>
    entity.fields.flatMap((field) => [
      `${entity.name}.${field.name}`.toLowerCase(),
      field.name.toLowerCase(),
    ]),
  );
  if (paths.length === 0) return () => true;
  return (name) => {
    const lower = name.trim().toLowerCase();
    return paths.some((path) => covers(lower, path));
  };
}
