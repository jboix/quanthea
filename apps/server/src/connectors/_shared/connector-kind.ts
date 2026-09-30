/** The contract of a connector kind: what it declares, and what an open connection can do. */
import type { Frame } from '@querent/shared';
import type { z } from 'zod';
import type { BoundQuery, ExecutionContext, QueryLanguage, SqlDialect } from './queries.ts';
import type { FieldReference, HealthReport, SampleResult, SchemaSnapshot } from './schema.ts';

/**
 * An open connection to one source. The core calls it only with bound queries and guardrails it has
 * already checked, and passes every result through its own checks.
 */
export interface ConnectorInstance {
  /**
   * Checks that the source answers and the credentials work.
   *
   * @param signal - Aborted when the caller gives up.
   * @returns The health report. A failed check is a report with `ok: false`, not an error.
   */
  test(signal: AbortSignal): Promise<HealthReport>;
  /**
   * Reads the shape of the source: entities and fields, never values.
   *
   * @param signal - Aborted when the caller gives up.
   * @returns The schema snapshot.
   * @throws {ConnectorError} When the source cannot be read.
   */
  describe(signal: AbortSignal): Promise<SchemaSnapshot>;
  /**
   * Reads distinct values of one field.
   *
   * @param field - The field, as named in the schema snapshot.
   * @param limit - How many values to return at most.
   * @param signal - Aborted when the caller gives up.
   * @returns The values, and whether there are more.
   * @throws {ConnectorError} When the field does not exist or the source fails.
   */
  sampleValues(field: FieldReference, limit: number, signal: AbortSignal): Promise<SampleResult>;
  /**
   * Runs a bound query.
   *
   * @param query - The query, in the connector kind's language.
   * @param context - The time range, row limit and abort signal to respect.
   * @returns One or more frames named `context.refId`.
   * @throws {ConnectorError} When the query fails, times out or is aborted.
   */
  execute(query: BoundQuery, context: ExecutionContext): Promise<Frame[]>;
  /**
   * Releases pooled connections. The core calls it when the connector is changed or deleted.
   *
   * @returns When everything is released.
   */
  close(): Promise<void>;
}

/** What {@link ConnectorKind.open} receives: the parsed configuration and credentials. */
export interface OpenOptions<Config, Secret> {
  /** The configuration, parsed with the kind's config schema. */
  readonly config: Config;
  /** The credentials, parsed with the kind's secret schema. */
  readonly secret: Secret;
}

/**
 * A kind of data source, such as PostgreSQL. It declares its settings as Zod schemas, from which the
 * app builds its forms, and opens connections.
 */
export interface ConnectorKind<
  ConfigSchema extends z.ZodType = z.ZodType,
  SecretSchema extends z.ZodType = z.ZodType,
> {
  /** A stable identifier, lowercase with dashes, such as `postgres`. Stored with each connector. */
  readonly kind: string;
  /** The name shown to people, such as `PostgreSQL`. */
  readonly displayName: string;
  /** One sentence shown when an admin picks a kind. */
  readonly description: string;
  /** The language of this kind's query templates. The core binds variables for it. */
  readonly language: QueryLanguage;
  /** The SQL dialect, which a `sql` kind must declare: how the core binds its templates. */
  readonly dialect?: SqlDialect;
  /**
   * Everything but the credentials: host, database, TLS options. Stored in plain text and shown to
   * admins. Give each field a title and a description with `.meta()`; the form is built from them.
   */
  readonly configSchema: ConfigSchema;
  /** The credentials. Stored encrypted and never returned by the API. */
  readonly secretSchema: SecretSchema;
  /**
   * How to get each shape of data in this kind's language, for the agent: about data, never about
   * charts. Adding a connector kind means adding its guide, with no chart recipe changing.
   */
  readonly queryGuide?: string;
  /**
   * Says where a connector points, shown under its name, such as
   * `postgres://dash_ro@orders-replica:5432/orders`. It must not include credentials.
   *
   * @param config - The parsed configuration.
   * @returns One line.
   */
  describeTarget?(config: z.output<ConfigSchema>): string;
  /**
   * Opens a connection. It must not contact the source; the first call does.
   *
   * @param options - The parsed configuration and credentials.
   * @returns The connection.
   */
  open(options: OpenOptions<z.output<ConfigSchema>, z.output<SecretSchema>>): ConnectorInstance;
}

/** A connector kind whatever its schemas, as the registry holds them. */
export type AnyConnectorKind = ConnectorKind<z.ZodType, z.ZodType>;

/** What a kind identifier looks like: lowercase letters, digits and dashes. */
const kindPattern = /^[a-z][a-z0-9-]*$/;

/**
 * Declares a connector kind. It checks the identifier and keeps the schema types for `open`.
 *
 * @param definition - The kind.
 * @returns The same kind.
 * @throws {Error} When the identifier is not lowercase letters, digits and dashes, or a SQL kind
 *   declares no dialect.
 */
export function defineConnector<ConfigSchema extends z.ZodType, SecretSchema extends z.ZodType>(
  definition: ConnectorKind<ConfigSchema, SecretSchema>,
): ConnectorKind<ConfigSchema, SecretSchema> {
  if (!kindPattern.test(definition.kind)) {
    throw new Error(
      `Connector kind "${definition.kind}" must be lowercase letters, digits and dashes.`,
    );
  }
  if (definition.language === 'sql' && definition.dialect === undefined)
    throw new Error(`Connector kind "${definition.kind}" runs SQL and must declare its dialect.`);
  return definition;
}
