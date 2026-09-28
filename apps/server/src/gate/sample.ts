/** Distinct values of a field for the model: from level 2, never hidden fields, never many. */
import {
  ConnectorError,
  type ConnectorInstance,
  type FieldReference,
} from '../connectors/_shared/index.ts';
import { lowCardinalityLimit } from './model-schema.ts';
import { type GateSubject, isHiddenField } from './subject.ts';

/** Sample values for the model. */
export type ModelSample =
  | { readonly ok: true; readonly values: readonly string[] }
  | { readonly ok: false; readonly error: string };

/**
 * Reads distinct values of a field for the model. Level 1 gets none, hidden fields get none, and a
 * field with more distinct values than asked for (at most {@link lowCardinalityLimit}) is refused,
 * so identifiers and personal data are not listed.
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
  const name = `${field.entity}.${field.field}`;
  if (subject.accessLevel < 2) {
    return {
      ok: false,
      error: `Sample values need access level 2 or higher; ${subject.name} is at level 1.`,
    };
  }
  if (isHiddenField(subject, field.entity, field.field))
    return { ok: false, error: `${name} is hidden.` };
  const capped = Math.max(1, Math.min(Math.trunc(limit), lowCardinalityLimit));
  try {
    const sample = await instance.sampleValues(field, capped, signal);
    if (!sample.complete)
      return { ok: false, error: `${name} has more than ${capped} distinct values.` };
    return { ok: true, values: sample.values };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof ConnectorError ? error.safeMessage : 'Sampling failed.',
    };
  }
}
