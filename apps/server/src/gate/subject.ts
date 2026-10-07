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
 * @param name - The field, column or label name.
 * @param hidden - The hidden names, in lower case.
 * @returns `true` when the name or one of its parent paths is hidden.
 */
export function isHiddenName(name: string, hidden: ReadonlySet<string>): boolean {
  const lower = name.toLowerCase();
  if (hidden.has(lower)) return true;
  for (let dot = lower.indexOf('.'); dot > 0; dot = lower.indexOf('.', dot + 1))
    if (hidden.has(lower.slice(0, dot))) return true;
  return false;
}

/**
 * Whether a field of an entity is hidden, such as `logs.user.email`, or a field under a hidden
 * object, such as `user.email` under `logs.user`. Names compare without case.
 *
 * @param subject - The connector.
 * @param entity - The entity name.
 * @param field - The field name, a dotted path for a nested field.
 * @returns `true` when `entity.field` or the bare `field` is hidden, or a parent of either.
 */
export function isHiddenField(subject: GateSubject, entity: string, field: string): boolean {
  const hidden = new Set(subject.hiddenFields.map((entry) => entry.toLowerCase()));
  return isHiddenName(`${entity}.${field}`, hidden) || isHiddenName(field, hidden);
}

/**
 * The names removed from query results, columns and labels alike, in lower case. Results do not
 * say which entity a column came from, and entity names can hold dots, so each hidden entry gives
 * every path that follows one of its dots: a hidden `logs.user.email` removes the result columns
 * `user.email` and `email` from every entity. A query that renames the column gets past this; a
 * database role or view that cannot read the column is the hard guarantee.
 *
 * @param subject - The connector.
 * @returns The names, to compare with {@link isHiddenName}.
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
