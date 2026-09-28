/** Reads and writes configured connectors and their cached schemas. */
import type { Database } from 'bun:sqlite';
import {
  type AccessLevel,
  accessLevelSchema,
  descriptionsSchema,
  type Guardrails,
  guardrailsSchema,
  hiddenFieldsSchema,
} from '@querent/shared';

/** A configured connector as stored. `config` is validated by its kind, not here. */
export interface ConnectorRow {
  /** The ULID. */
  readonly id: string;
  /** The unique name dashboards refer to. */
  readonly name: string;
  /** The connector kind identifier, such as `postgres`. */
  readonly kind: string;
  /** The kind's configuration, parsed from JSON. */
  readonly config: unknown;
  /** The sealed credentials. */
  readonly secret: Uint8Array;
  /** What the model may see. */
  readonly accessLevel: AccessLevel;
  /** Fields removed from everything the model receives. */
  readonly hiddenFields: readonly string[];
  /** The limits enforced on every query. */
  readonly guardrails: Guardrails;
  /** Admin-written descriptions, keyed by `entity` or `entity.field`. */
  readonly descriptions: Readonly<Record<string, string>>;
  /** Creation time, in epoch milliseconds. */
  readonly createdAt: number;
  /** Last change, in epoch milliseconds. */
  readonly updatedAt: number;
}

/** A cached schema snapshot. */
export interface CachedSchema {
  /** The snapshot, parsed from JSON. */
  readonly snapshot: unknown;
  /** When it was read from the source, in epoch milliseconds. */
  readonly readAt: number;
}

/** Stores configured connectors. */
export interface ConnectorRepository {
  /**
   * Lists every connector.
   *
   * @returns The connectors, sorted by name.
   */
  list(): ConnectorRow[];
  /**
   * Finds a connector by id.
   *
   * @param id - The connector id.
   * @returns The connector, or `undefined`.
   */
  get(id: string): ConnectorRow | undefined;
  /**
   * Finds a connector by name.
   *
   * @param name - The connector name.
   * @returns The connector, or `undefined`.
   */
  getByName(name: string): ConnectorRow | undefined;
  /**
   * Inserts a new connector or replaces the one with the same id.
   *
   * @param row - The connector.
   */
  save(row: ConnectorRow): void;
  /**
   * Deletes a connector and its cached schema.
   *
   * @param id - The connector id.
   * @returns `true` when a connector was deleted.
   */
  remove(id: string): boolean;
  /**
   * Reads the cached schema of a connector.
   *
   * @param id - The connector id.
   * @returns The cached schema, or `undefined` when it was never read.
   */
  readSchema(id: string): CachedSchema | undefined;
  /**
   * Stores the schema read from a connector.
   *
   * @param id - The connector id.
   * @param schema - The snapshot and when it was read.
   */
  writeSchema(id: string, schema: CachedSchema): void;
}

/** A `connectors` row as SQLite returns it. */
interface StoredConnector {
  /** The id. */
  id: string;
  /** The name. */
  name: string;
  /** The kind. */
  kind: string;
  /** The configuration JSON. */
  config: string;
  /** The sealed credentials. */
  secret: Uint8Array;
  /** The access level. */
  access_level: number;
  /** The hidden fields JSON. */
  hidden_fields: string;
  /** The guardrails JSON. */
  guardrails: string;
  /** The descriptions JSON. */
  descriptions: string;
  /** Creation time. */
  created_at: number;
  /** Last change. */
  updated_at: number;
}

/**
 * Turns a stored row into a connector, validating its JSON columns.
 *
 * @param stored - The row.
 * @returns The connector.
 * @throws {Error} When a column no longer matches its schema.
 */
function toConnector(stored: StoredConnector): ConnectorRow {
  return {
    id: stored.id,
    name: stored.name,
    kind: stored.kind,
    config: JSON.parse(stored.config),
    secret: new Uint8Array(stored.secret),
    accessLevel: accessLevelSchema.parse(stored.access_level),
    hiddenFields: hiddenFieldsSchema.parse(JSON.parse(stored.hidden_fields)),
    guardrails: guardrailsSchema.parse(JSON.parse(stored.guardrails)),
    descriptions: descriptionsSchema.parse(JSON.parse(stored.descriptions)),
    createdAt: stored.created_at,
    updatedAt: stored.updated_at,
  };
}

/**
 * Turns a connector into the values of an insert, in column order.
 *
 * @param row - The connector.
 * @returns The values.
 */
function toValues(row: ConnectorRow) {
  return [
    row.id,
    row.name,
    row.kind,
    JSON.stringify(row.config),
    row.secret,
    row.accessLevel,
    JSON.stringify(row.hiddenFields),
    JSON.stringify(row.guardrails),
    JSON.stringify(row.descriptions),
    row.createdAt,
    row.updatedAt,
  ] as const;
}

/**
 * Creates the schema cache half of the repository.
 *
 * @param database - A database the migrations have run on.
 * @returns The two schema cache methods.
 */
function schemaCache(database: Database): Pick<ConnectorRepository, 'readSchema' | 'writeSchema'> {
  const select = database.query<{ snapshot: string; read_at: number }, [string]>(
    'SELECT snapshot, read_at FROM schema_cache WHERE connector_id = ?',
  );
  const upsert = database.query(
    `INSERT INTO schema_cache (connector_id, snapshot, read_at) VALUES (?, ?, ?)
     ON CONFLICT (connector_id) DO UPDATE SET snapshot = excluded.snapshot, read_at = excluded.read_at`,
  );
  return {
    readSchema: (id) => {
      const row = select.get(id);
      return row ? { snapshot: JSON.parse(row.snapshot), readAt: row.read_at } : undefined;
    },
    writeSchema: (id, schema) => {
      upsert.run(id, JSON.stringify(schema.snapshot), schema.readAt);
    },
  };
}

/**
 * Creates the repository over an open database.
 *
 * @param database - A database the migrations have run on.
 * @returns The repository.
 */
export function createConnectorRepository(database: Database): ConnectorRepository {
  const selectAll = database.query<StoredConnector, []>('SELECT * FROM connectors ORDER BY name');
  const selectById = database.query<StoredConnector, [string]>(
    'SELECT * FROM connectors WHERE id = ?',
  );
  const selectByName = database.query<StoredConnector, [string]>(
    'SELECT * FROM connectors WHERE name = ?',
  );
  // An upsert on id: a name taken by another connector fails instead of replacing it.
  const upsert = database.query(
    `INSERT INTO connectors (id, name, kind, config, secret, access_level, hidden_fields, guardrails,
       descriptions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET name = excluded.name, kind = excluded.kind,
       config = excluded.config, secret = excluded.secret, access_level = excluded.access_level,
       hidden_fields = excluded.hidden_fields, guardrails = excluded.guardrails,
       descriptions = excluded.descriptions, updated_at = excluded.updated_at`,
  );
  const deleteById = database.query('DELETE FROM connectors WHERE id = ?');
  return {
    list: () => selectAll.all().map(toConnector),
    get: (id) => {
      const stored = selectById.get(id);
      return stored ? toConnector(stored) : undefined;
    },
    getByName: (name) => {
      const stored = selectByName.get(name);
      return stored ? toConnector(stored) : undefined;
    },
    save: (row) => {
      upsert.run(...toValues(row));
    },
    remove: (id) => deleteById.run(id).changes > 0,
    ...schemaCache(database),
  };
}
