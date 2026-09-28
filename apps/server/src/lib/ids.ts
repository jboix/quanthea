/** Identifiers for stored rows: ULIDs, which sort by creation time. */
import { monotonicFactory } from 'ulid';

/** Generates ULIDs that increase strictly, even within one millisecond. */
const nextUlid = monotonicFactory();

/**
 * Creates an identifier for a new row.
 *
 * @returns A 26-character ULID. Identifiers created later sort after it.
 */
export function newId(): string {
  return nextUlid();
}
