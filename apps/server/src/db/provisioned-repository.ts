/** Reads and writes rows of the `provisioned` table: what the configuration file manages. */
import type { Database } from 'bun:sqlite';

/** A kind of item the file manages. */
export type ProvisionedKind = 'connector' | 'provider' | 'user' | 'settings';

/** An item the file manages. */
export interface ProvisionedRow {
  /** Its kind. */
  readonly kind: ProvisionedKind;
  /** Its name: a connector's name, a provider's id, a settings section, or a user's email hash. */
  readonly name: string;
  /** The file that declares it. */
  readonly path: string;
  /** A keyed hash of what was last applied. */
  readonly fingerprint: Uint8Array;
  /** The fields the file leaves to the interface. */
  readonly editable: readonly string[];
  /** When it was last applied. */
  readonly appliedAt: number;
}

/** Stores what the file manages. */
export interface ProvisionedRepository {
  /**
   * Lists the items of a kind.
   *
   * @param kind - The kind.
   * @returns The items.
   */
  list(kind: ProvisionedKind): ProvisionedRow[];
  /**
   * Reads one item.
   *
   * @param kind - Its kind.
   * @param name - Its name.
   * @returns The item, or `undefined` when the file does not manage it.
   */
  get(kind: ProvisionedKind, name: string): ProvisionedRow | undefined;
  /**
   * Records an item as managed, replacing what was recorded.
   *
   * @param row - The item.
   */
  put(row: ProvisionedRow): void;
  /**
   * Stops managing an item.
   *
   * @param kind - Its kind.
   * @param name - Its name.
   */
  remove(kind: ProvisionedKind, name: string): void;
}

/** A row as SQLite returns it. */
interface StoredRow {
  /** The kind. */
  readonly kind: ProvisionedKind;
  /** The name. */
  readonly name: string;
  /** The file. */
  readonly path: string;
  /** The fingerprint. */
  readonly fingerprint: Uint8Array;
  /** The editable fields, as JSON. */
  readonly editable: string;
  /** When it was applied. */
  readonly applied_at: number;
}

/**
 * A stored row as the repository returns it.
 *
 * @param row - The stored row.
 * @returns The item.
 */
function fromStored(row: StoredRow): ProvisionedRow {
  return {
    kind: row.kind,
    name: row.name,
    path: row.path,
    fingerprint: new Uint8Array(row.fingerprint),
    editable: JSON.parse(row.editable) as string[],
    appliedAt: row.applied_at,
  };
}

/**
 * Creates the repository over an open database.
 *
 * @param database - A database the migrations have run on.
 * @returns The repository.
 */
export function createProvisionedRepository(database: Database): ProvisionedRepository {
  const columns = 'kind, name, path, fingerprint, editable, applied_at';
  const byKind = database.query<StoredRow, [string]>(
    `SELECT ${columns} FROM provisioned WHERE kind = ? ORDER BY name`,
  );
  const one = database.query<StoredRow, [string, string]>(
    `SELECT ${columns} FROM provisioned WHERE kind = ? AND name = ?`,
  );
  const upsert = database.query<unknown, [string, string, string, Uint8Array, string, number]>(
    `INSERT OR REPLACE INTO provisioned (${columns}) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const drop = database.query<unknown, [string, string]>(
    'DELETE FROM provisioned WHERE kind = ? AND name = ?',
  );
  return {
    list: (kind) => byKind.all(kind).map(fromStored),
    get: (kind, name) => {
      const row = one.get(kind, name);
      return row ? fromStored(row) : undefined;
    },
    put: (row) => {
      const editable = JSON.stringify(row.editable);
      upsert.run(row.kind, row.name, row.path, row.fingerprint, editable, row.appliedAt);
    },
    remove: (kind, name) => {
      drop.run(kind, name);
    },
  };
}
