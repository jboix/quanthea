/** What the gate knows about a connector: its access level, hidden fields and descriptions. */
import type { AccessLevel } from '@quanthea/shared';

/** A connector as the gate sees it. */
export interface GateSubject {
  /** The connector name. */
  readonly name: string;
  /** The connector kind, such as `postgres`. */
  readonly kind: string;
  /** What the model may see. */
  readonly accessLevel: AccessLevel;
  /** `entity.field` or bare `field` entries removed from everything the model receives. */
  readonly hiddenFields: readonly string[];
  /** Admin-written descriptions by `entity` or `entity.field`; they replace the source's. */
  readonly descriptions: Readonly<Record<string, string>>;
}

/**
 * Whether a name is hidden: equal to a hidden name, or under one, as `user.email` is under a
 * hidden `user`. Names compare without case.
 *
 * @param name - The field, column or label name, in lower case.
 * @param hidden - The hidden names, in lower case.
 * @returns `true` when the name or one of its parent paths is hidden.
 */
function isUnderHiddenName(name: string, hidden: ReadonlySet<string>): boolean {
  if (hidden.has(name)) return true;
  for (let dot = name.indexOf('.'); dot > 0; dot = name.indexOf('.', dot + 1))
    if (hidden.has(name.slice(0, dot))) return true;
  return false;
}

/**
 * Whether a name holds a hidden one, as `user` holds a hidden `user.email`: its value can carry
 * the hidden field, such as a search document's array of objects.
 *
 * @param name - The field, column or label name, in lower case.
 * @param hidden - The hidden names, in lower case.
 * @returns `true` when a hidden name lies under it.
 */
function holdsHiddenName(name: string, hidden: Iterable<string>): boolean {
  const prefix = `${name}.`;
  for (const entry of hidden) if (entry.startsWith(prefix)) return true;
  return false;
}

/**
 * Whether a result column or label is hidden: it is a hidden name, lies under one, holds one, or
 * ends with one, as `c.email` ends with `email`. Names compare without case.
 *
 * @param name - The column or label name.
 * @param hidden - The names from {@link hiddenResultNames}.
 * @returns `true` when the column or label must not reach the model.
 */
export function isHiddenResultName(name: string, hidden: ReadonlySet<string>): boolean {
  const lower = name.toLowerCase();
  const last = lower.slice(lower.lastIndexOf('.') + 1);
  return isUnderHiddenName(lower, hidden) || hidden.has(last) || holdsHiddenName(lower, hidden);
}

/**
 * The hidden fields of a connector, in lower case.
 *
 * @param subject - The connector.
 * @returns The hidden entries.
 */
function hiddenEntries(subject: GateSubject): ReadonlySet<string> {
  return new Set(subject.hiddenFields.map((entry) => entry.toLowerCase()));
}

/**
 * Whether a field of an entity is hidden, such as `logs.user.email`, or a field under a hidden
 * object, such as `user.email` under `logs.user`. This is what the admin set. Names compare
 * without case.
 *
 * @param subject - The connector.
 * @param entity - The entity name.
 * @param field - The field name, a dotted path for a nested field.
 * @returns `true` when `entity.field` or the bare `field` is hidden, or a parent of either.
 */
export function isHiddenField(subject: GateSubject, entity: string, field: string): boolean {
  const hidden = hiddenEntries(subject);
  const path = `${entity}.${field}`.toLowerCase();
  return isUnderHiddenName(path, hidden) || isUnderHiddenName(field.toLowerCase(), hidden);
}

/**
 * Whether the model is kept from a field: it is hidden, or it holds a hidden field, as an object
 * or nested `user` holds a hidden `logs.user.email`. Names compare without case.
 *
 * @param subject - The connector.
 * @param entity - The entity name.
 * @param field - The field name, a dotted path for a nested field.
 * @returns `true` when the field must not reach the model.
 */
export function isWithheldField(subject: GateSubject, entity: string, field: string): boolean {
  if (isHiddenField(subject, entity, field)) return true;
  const hidden = hiddenEntries(subject);
  const path = `${entity}.${field}`.toLowerCase();
  return holdsHiddenName(path, hidden) || holdsHiddenName(field.toLowerCase(), hidden);
}

/**
 * The names removed from query results, columns and labels alike, in lower case. Results do not
 * say which entity a column came from, and entity names can hold dots, so each hidden entry gives
 * every path that follows one of its dots: a hidden `logs.user.email` removes the result columns
 * `user.email` and `email` from every entity, and with {@link isHiddenResultName} also `user`,
 * which holds it, and `c.email`, which ends with it. A query that renames the column gets past
 * this; a database role or view that cannot read the column is the hard guarantee.
 *
 * @param subject - The connector.
 * @returns The names, to compare with {@link isHiddenResultName}.
 */
export function hiddenResultNames(subject: GateSubject): ReadonlySet<string> {
  const names = new Set<string>();
  for (const entry of subject.hiddenFields) {
    const lower = entry.toLowerCase();
    names.add(lower);
    for (let dot = lower.indexOf('.'); dot >= 0; dot = lower.indexOf('.', dot + 1))
      names.add(lower.slice(dot + 1));
  }
  return names;
}
