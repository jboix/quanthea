/** Turns stored connectors into what the API returns: masked credentials, schema views. */
import {
  type ConnectorDetail,
  type ConnectorSummary,
  lowCardinalityLimit,
  type SchemaView,
} from '@quanthea/shared';
import type { SchemaEntity, SchemaField, SchemaSnapshot } from '../connectors/_shared/index.ts';
import type { ConnectorRow } from '../db/connector-repository.ts';
import { type GateSubject, isHiddenField, isWithheldField } from '../gate/subject.ts';
import {
  isSystemObject,
  namingOf,
  type ObjectScope,
  showsObject,
} from '../query/scope/object-scope.ts';
import { maskSecret } from '../secrets/mask.ts';

/**
 * The list entry of a connector.
 *
 * @param row - The stored connector.
 * @param installed - Whether its kind is offered.
 * @returns The summary.
 */
export function toSummary(row: ConnectorRow, installed: boolean): ConnectorSummary {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    accessLevel: row.accessLevel,
    updatedAt: row.updatedAt,
    installed,
  };
}

/**
 * The detail of a connector, with its credentials masked.
 *
 * @param row - The stored connector.
 * @param secret - The decrypted credentials.
 * @param target - Where the connector points, from its kind, or `null`.
 * @param installed - Whether its kind is offered.
 * @returns The detail.
 */
export function toDetail(
  row: ConnectorRow,
  secret: Readonly<Record<string, unknown>>,
  target: string | null,
  installed = true,
): ConnectorDetail {
  const masked = Object.fromEntries(
    Object.entries(secret)
      .filter(([, value]) => value !== undefined && value !== '')
      .map(([name, value]) => [name, maskSecret(value)]),
  );
  return {
    ...toSummary(row, installed),
    config: (row.config ?? {}) as Record<string, unknown>,
    target,
    secret: masked,
    hiddenFields: [...row.hiddenFields],
    visibility: { ...row.visibility, names: [...row.visibility.names] },
    guardrails: row.guardrails,
    descriptions: { ...row.descriptions },
    createdAt: row.createdAt,
  };
}

/**
 * The gate subject of a stored connector.
 *
 * @param row - The stored connector.
 * @param scope - Which objects it shows, by its kind's naming rules.
 * @returns The subject.
 */
export function toSubject(row: ConnectorRow, scope: ObjectScope): GateSubject {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    accessLevel: row.accessLevel,
    hiddenFields: row.hiddenFields,
    scope,
    descriptions: row.descriptions,
  };
}

/**
 * What the model sees of a field, following the gate.
 *
 * @param subject - The connector.
 * @param entity - The entity name.
 * @param field - The field.
 * @returns `nothing` when hidden, `values` when it can be sampled, `name` otherwise.
 */
function modelSees(
  subject: GateSubject,
  entity: string,
  field: SchemaField,
): 'values' | 'name' | 'nothing' {
  if (isWithheldField(subject, entity, field.name)) return 'nothing';
  const few = field.distinctEstimate !== undefined && field.distinctEstimate <= lowCardinalityLimit;
  return subject.accessLevel >= 2 && few ? 'values' : 'name';
}

/**
 * One entity of the schema view.
 *
 * @param subject - The connector.
 * @param entity - The entity from the snapshot.
 * @returns The entity as admins see it.
 */
function entityView(subject: GateSubject, entity: SchemaEntity): SchemaView['entities'][number] {
  const adminDescription = subject.descriptions[entity.name];
  return {
    name: entity.name,
    kind: entity.kind,
    ...(entity.description === undefined ? {} : { description: entity.description }),
    ...(adminDescription === undefined ? {} : { adminDescription }),
    ...(entity.rowEstimate === undefined ? {} : { rows: entity.rowEstimate }),
    system: isSystemObject(subject.scope.family, entity.name),
    shown: showsObject(subject.scope, entity.name),
    fields: entity.fields.map((field) => {
      const fieldAdminDescription = subject.descriptions[`${entity.name}.${field.name}`];
      return {
        name: field.name,
        type: field.nativeType,
        ...(field.description === undefined ? {} : { description: field.description }),
        ...(fieldAdminDescription === undefined ? {} : { adminDescription: fieldAdminDescription }),
        hidden: isHiddenField(subject, entity.name, field.name),
        ...(field.distinctEstimate === undefined ? {} : { distinctValues: field.distinctEstimate }),
        modelSees: modelSees(subject, entity.name, field),
      };
    }),
  };
}

/**
 * The schema of a connector as admins see it: every object, with whether the connector shows it,
 * and every field, hidden ones marked, with what the model gets of each.
 *
 * @param subject - The connector, as the gate sees it.
 * @param snapshot - The cached snapshot, if the schema was ever read.
 * @param readAt - When it was read.
 * @returns The schema view.
 */
export function toSchemaView(
  subject: GateSubject,
  snapshot: SchemaSnapshot | undefined,
  readAt: number | null,
): SchemaView {
  return {
    readAt,
    naming: namingOf(subject.scope.family),
    entities: (snapshot?.entities ?? []).map((entity) => entityView(subject, entity)),
  };
}
