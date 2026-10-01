/** What a connector reports about its source: health, schema and sample values. */
import type { FieldType } from '@quanthea/shared';

/** The result of a connection test. */
export interface HealthReport {
  /** Whether the source answered and the credentials worked. */
  readonly ok: boolean;
  /** Round-trip time of the test, in milliseconds. */
  readonly latencyMs: number;
  /** A short sentence for the admin, such as the server version or why the test failed. */
  readonly message: string;
  /** Whether the credentials can only read: `true`, `false`, or `null` when the source cannot tell. */
  readonly readOnly: boolean | null;
}

/** One field of a schema entity: a column, a label, a document field. */
export interface SchemaField {
  /** The field name as queries write it. */
  readonly name: string;
  /** The source's own type name, such as `timestamptz` or `keyword`. */
  readonly nativeType: string;
  /** The frame type the field maps to, when known. */
  readonly type?: FieldType;
  /** A description from the source, such as a column comment. */
  readonly description?: string;
  /** An estimate of the number of distinct values, when the source knows it cheaply. */
  readonly distinctEstimate?: number;
}

/** A queryable thing in the source: a table, a view, a metric, an index. */
export interface SchemaEntity {
  /** The name as queries write it, qualified when the source needs it (`public.orders`). */
  readonly name: string;
  /** What kind of thing it is, for display. */
  readonly kind: 'table' | 'view' | 'metric' | 'index' | 'endpoint' | 'collection';
  /** A description from the source, such as a table comment or a metric's help text. */
  readonly description?: string;
  /** An estimate of the number of rows or series, when the source knows it cheaply. */
  readonly rowEstimate?: number;
  /** The fields. */
  readonly fields: readonly SchemaField[];
}

/** The shape of a source: every entity and its fields, never their values. */
export interface SchemaSnapshot {
  /** The entities, in the order to show them. */
  readonly entities: readonly SchemaEntity[];
}

/** Names one field of one entity. */
export interface FieldReference {
  /** The entity name, as in {@link SchemaEntity.name}. */
  readonly entity: string;
  /** The field name, as in {@link SchemaField.name}. */
  readonly field: string;
}

/** Distinct values of a field. */
export interface SampleResult {
  /** At most the requested number of distinct values. */
  readonly values: readonly string[];
  /** `false` when the field has more distinct values than were requested. */
  readonly complete: boolean;
}
