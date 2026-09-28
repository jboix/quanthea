/** What the gate knows about a connector: its access level, hidden fields and descriptions. */
import type { AccessLevel } from '@querent/shared';

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
 * Whether a field of an entity is hidden.
 *
 * @param subject - The connector.
 * @param entity - The entity name.
 * @param field - The field name.
 * @returns `true` when `entity.field` or the bare `field` is hidden.
 */
export function isHiddenField(subject: GateSubject, entity: string, field: string): boolean {
  return (
    subject.hiddenFields.includes(`${entity}.${field}`) || subject.hiddenFields.includes(field)
  );
}

/**
 * The field names removed from query results. Results do not say which entity a column came from,
 * so a hidden `customers.email` removes every result column named `email`. A query that renames
 * the column gets past this; a database role or view that cannot read the column is the hard
 * guarantee.
 *
 * @param subject - The connector.
 * @returns The names, compared exactly.
 */
export function hiddenResultNames(subject: GateSubject): ReadonlySet<string> {
  return new Set(subject.hiddenFields.map((entry) => entry.slice(entry.lastIndexOf('.') + 1)));
}
