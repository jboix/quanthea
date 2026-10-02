/** Identifiers for stored rows: ULIDs, which sort by creation time, and random snapshot ids. */
import { monotonicFactory } from 'ulid';

/** Generates ULIDs that increase strictly, even within one millisecond. */
const nextUlid = monotonicFactory();

/** How many random bytes a snapshot id holds: 128 bits. */
const snapshotIdBytes = 16;

/**
 * Creates an identifier for a new row.
 *
 * @returns A 26-character ULID. Identifiers created later sort after it.
 */
export function newId(): string {
  return nextUlid();
}

/**
 * Creates the id of a snapshot link, which no one can guess without the link.
 *
 * @returns 128 random bits from WebCrypto, as 22 URL-safe base64 characters.
 */
export function newSnapshotId(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(snapshotIdBytes))).toString('base64url');
}
