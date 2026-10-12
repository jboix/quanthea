/**
 * Distinct values of a field for the model: from level 2, never of an object the connector does
 * not show, never hidden fields, never many. A search entity is an index expression, so it is
 * resolved and narrowed as a query's is.
 */
import { lowCardinalityLimit } from '@quanthea/shared';
import {
  ConnectorError,
  type ConnectorInstance,
  type FieldReference,
} from '../connectors/_shared/index.ts';
import { QueryError } from '../query/query-error.ts';
import { checkScope } from '../query/scope/check.ts';
import { showsObject } from '../query/scope/object-scope.ts';
import { narrowSearch } from '../query/scope/search-scope.ts';
import { type GateSubject, isWithheldField } from './subject.ts';

/** Sample values for the model. */
export type ModelSample =
  | { readonly ok: true; readonly values: readonly string[] }
  | { readonly ok: false; readonly error: string };

/**
 * Why a field gives the model no values before the source is asked, if it does not.
 *
 * @param subject - The connector.
 * @param field - The entity and field.
 * @returns The reason, or `undefined` when the field may be sampled.
 */
function refusal(subject: GateSubject, field: FieldReference): string | undefined {
  if (subject.accessLevel < 2)
    return `Sample values need access level 2 or higher; ${subject.name} is at level 1.`;
  if (!showsObject(subject.scope, field.entity))
    return `${subject.name} does not show ${field.entity}.`;
  if (isWithheldField(subject, field.entity, field.field))
    return `${field.entity}.${field.field} is hidden.`;
  return undefined;
}

/**
 * The entity the source samples. An index expression of a search source can be a pattern, a list
 * or an alias, so its names are checked and the source resolves it, as for a query: the hidden
 * indices it reaches are excluded.
 *
 * @param subject - The connector.
 * @param instance - The open connection.
 * @param entity - The entity the model named.
 * @param signal - Aborted when the caller gives up.
 * @returns The entity, narrowed to what the connector shows.
 * @throws {QueryError} `invalid` when the expression names or reaches only hidden indices.
 * @throws {ConnectorError} When the source cannot resolve the expression.
 */
async function shownEntity(
  subject: GateSubject,
  instance: ConnectorInstance,
  entity: string,
  signal: AbortSignal,
): Promise<string> {
  if (subject.scope.family !== 'search') return entity;
  const query = { language: 'search', index: entity, body: {} } as const;
  checkScope(subject.scope, query);
  return (await narrowSearch(subject.scope, query, instance, signal)).index;
}

/**
 * The message of a failed sample that the model may read.
 *
 * @param error - What was thrown.
 * @returns The safe message of a connector or query error, a fixed one otherwise.
 */
function safeMessageOf(error: unknown): string {
  if (error instanceof ConnectorError || error instanceof QueryError) return error.safeMessage;
  return 'Sampling failed.';
}

/**
 * Reads distinct values of a field for the model. Level 1 gets none, an object the connector does
 * not show gets none, hidden fields get none, and a
 * field with more distinct values than asked for (at most {@link lowCardinalityLimit}) is refused,
 * so identifiers and personal data are not listed. On a search source the hidden indices a pattern
 * or an alias reaches are left out of the sample.
 *
 * @param subject - The connector.
 * @param instance - The open connection.
 * @param field - The entity and field.
 * @param limit - How many values the model asked for.
 * @param signal - Aborted when the caller gives up.
 * @returns The values, or why there are none. It never throws.
 */
export async function sampleForModel(
  subject: GateSubject,
  instance: ConnectorInstance,
  field: FieldReference,
  limit: number,
  signal: AbortSignal,
): Promise<ModelSample> {
  const refused = refusal(subject, field);
  if (refused !== undefined) return { ok: false, error: refused };
  const capped = Math.max(1, Math.min(Math.trunc(limit), lowCardinalityLimit));
  try {
    const entity = await shownEntity(subject, instance, field.entity, signal);
    const sample = await instance.sampleValues({ ...field, entity }, capped, signal);
    if (!sample.complete)
      return {
        ok: false,
        error: `${field.entity}.${field.field} has more than ${capped} distinct values.`,
      };
    return { ok: true, values: sample.values };
  } catch (error) {
    return { ok: false, error: safeMessageOf(error) };
  }
}
