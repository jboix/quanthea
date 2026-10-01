/** The schema the model receives: the snapshot minus hidden fields, with metadata by access level. */
import { lowCardinalityLimit } from '@quanthea/shared';
import type { SchemaEntity, SchemaField, SchemaSnapshot } from '../connectors/_shared/index.ts';
import { type GateSubject, isHiddenField } from './subject.ts';

/** A field as the model sees it. */
export interface ModelField {
  /** The field name. */
  readonly name: string;
  /** The source's type name. */
  readonly type: string;
  /** The admin's or the source's description. */
  readonly description?: string;
  /** From level 2: how many distinct values, when there are few enough to sample. */
  readonly distinctValues?: number;
}

/** An entity as the model sees it. */
export interface ModelEntity {
  /** The entity name. */
  readonly name: string;
  /** Table, view, metric, index or endpoint. */
  readonly kind: SchemaEntity['kind'];
  /** The admin's or the source's description. */
  readonly description?: string;
  /** From level 2: the estimated number of rows or series. */
  readonly rows?: number;
  /** The fields that are not hidden. */
  readonly fields: readonly ModelField[];
}

/**
 * The description to show: the admin's when there is one.
 *
 * @param subject - The connector.
 * @param key - `entity` or `entity.field`.
 * @param fromSource - The source's description.
 * @returns The description, or `undefined`.
 */
function descriptionOf(
  subject: GateSubject,
  key: string,
  fromSource: string | undefined,
): string | undefined {
  return subject.descriptions[key] ?? fromSource;
}

/**
 * Turns one field into what the model sees.
 *
 * @param subject - The connector.
 * @param entity - The entity name.
 * @param field - The field.
 * @returns The field for the model.
 */
function modelField(subject: GateSubject, entity: string, field: SchemaField): ModelField {
  const description = descriptionOf(subject, `${entity}.${field.name}`, field.description);
  const distinct = field.distinctEstimate;
  const showDistinct =
    subject.accessLevel >= 2 && distinct !== undefined && distinct <= lowCardinalityLimit;
  return {
    name: field.name,
    type: field.nativeType,
    ...(description === undefined ? {} : { description }),
    ...(showDistinct ? { distinctValues: distinct } : {}),
  };
}

/**
 * Turns one entity into what the model sees.
 *
 * @param subject - The connector.
 * @param entity - The entity.
 * @returns The entity for the model.
 */
function modelEntity(subject: GateSubject, entity: SchemaEntity): ModelEntity {
  const description = descriptionOf(subject, entity.name, entity.description);
  const showRows = subject.accessLevel >= 2 && entity.rowEstimate !== undefined;
  return {
    name: entity.name,
    kind: entity.kind,
    ...(description === undefined ? {} : { description }),
    ...(showRows ? { rows: entity.rowEstimate } : {}),
    fields: entity.fields
      .filter((field) => !isHiddenField(subject, entity.name, field.name))
      .map((field) => modelField(subject, entity.name, field)),
  };
}

/**
 * The schema the model receives. Hidden fields are removed at every level. Level 1 gets names,
 * types and descriptions; from level 2 it also gets row estimates and the number of distinct values
 * of fields with few of them.
 *
 * @param subject - The connector.
 * @param snapshot - The schema read from the source.
 * @returns The entities for the model.
 */
export function modelSchema(subject: GateSubject, snapshot: SchemaSnapshot): ModelEntity[] {
  return snapshot.entities.map((entity) => modelEntity(subject, entity));
}
