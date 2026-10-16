/**
 * Reads and writes definitions as versions. A version is stored once and never changed or removed
 * (triggers on the table); saving adds a version, and the latest of each definition is the one
 * used. A deletion is a version that says so.
 */
import type { Database } from 'bun:sqlite';

/** Where a version came from: the interface, or the provisioning file. */
export type DefinitionOrigin = 'ui' | 'file';

/** A stored version, its definition parsed but not validated. */
export interface DefinitionRow {
  /** The definition's id, such as `error-rate`. */
  readonly definitionId: string;
  /** The version, from 1 for each definition. */
  readonly version: number;
  /** The definition as saved. */
  readonly definition: unknown;
  /** Whether this version deletes the definition. */
  readonly deleted: boolean;
  /** Where it came from. */
  readonly origin: DefinitionOrigin;
  /** Who saved it, by user id, or the file for a provisioned one. */
  readonly actor: string;
  /** When, in epoch milliseconds. */
  readonly createdAt: number;
}

/** A version to add: the repository numbers it. */
export type NewDefinition = Omit<DefinitionRow, 'version'>;

/** Stores definitions. */
export interface DefinitionRepository {
  /**
   * Adds a version after the latest one, unless another was added since the one it is based on.
   *
   * @param row - The version.
   * @param basedOn - The latest version the change started from, or `null` for a new definition
   *   (one never saved, or deleted).
   * @returns The stored version, or `undefined` when the latest is no longer `basedOn`.
   */
  add(row: NewDefinition, basedOn: number | null): DefinitionRow | undefined;
  /**
   * Reads the latest version of a definition, deleted or not.
   *
   * @param definitionId - The definition.
   * @returns The version, or `undefined` when there is none.
   */
  latest(definitionId: string): DefinitionRow | undefined;
  /**
   * Reads the latest version of every definition that is not deleted.
   *
   * @returns The versions, by id.
   */
  current(): DefinitionRow[];
  /**
   * Reads every version of a definition.
   *
   * @param definitionId - The definition.
   * @returns The versions, latest first.
   */
  history(definitionId: string): DefinitionRow[];
}

/** A version as SQLite returns it. */
interface StoredDefinition {
  /** The id. */
  definition_id: string;
  /** The version. */
  version: number;
  /** The definition, JSON. */
  definition: string;
  /** 1 when it deletes the definition. */
  deleted: number;
  /** Where it came from. */
  origin: DefinitionOrigin;
  /** Who saved it. */
  actor: string;
  /** When. */
  created_at: number;
}

/**
 * Turns a stored version into a row.
 *
 * @param stored - The stored version.
 * @returns The row.
 */
function rowOf(stored: StoredDefinition): DefinitionRow {
  return {
    definitionId: stored.definition_id,
    version: stored.version,
    definition: JSON.parse(stored.definition),
    deleted: stored.deleted === 1,
    origin: stored.origin,
    actor: stored.actor,
    createdAt: stored.created_at,
  };
}

/**
 * Prepares the statements.
 *
 * @param database - The database.
 * @returns The insert and the reads.
 */
function statements(database: Database) {
  const select = 'SELECT * FROM definition_versions';
  return {
    insert: database.query(
      `INSERT INTO definition_versions (definition_id, version, definition, deleted, origin, actor,
         created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ),
    latest: database.query<StoredDefinition, [string]>(
      `${select} WHERE definition_id = ? ORDER BY version DESC LIMIT 1`,
    ),
    current: database.query<StoredDefinition, []>(
      `${select} AS v WHERE deleted = 0 AND version = (SELECT max(version) FROM definition_versions
         WHERE definition_id = v.definition_id) ORDER BY definition_id`,
    ),
    history: database.query<StoredDefinition, [string]>(
      `${select} WHERE definition_id = ? ORDER BY version DESC`,
    ),
  };
}

/**
 * Creates the repository over an open database.
 *
 * @param database - A database the migrations have run on.
 * @returns The repository.
 */
export function createDefinitionRepository(database: Database): DefinitionRepository {
  const prepared = statements(database);
  const readLatest = (definitionId: string) => {
    const stored = prepared.latest.get(definitionId);
    return stored ? rowOf(stored) : undefined;
  };
  const add = database.transaction((row: NewDefinition, basedOn: number | null) => {
    const latest = readLatest(row.definitionId);
    // A deleted definition is no definition: a new one with its id starts from nothing.
    const current = latest && !latest.deleted ? latest.version : null;
    if (current !== basedOn) return undefined;
    const stored = { ...row, version: (latest?.version ?? 0) + 1 };
    const { definitionId, version, deleted, origin, actor, createdAt } = stored;
    const json = JSON.stringify(row.definition);
    prepared.insert.run(definitionId, version, json, deleted ? 1 : 0, origin, actor, createdAt);
    return stored;
  });
  return {
    add: (row, basedOn) => add(row, basedOn),
    latest: readLatest,
    current: () => prepared.current.all().map(rowOf),
    history: (definitionId) => prepared.history.all(definitionId).map(rowOf),
  };
}
