/** A stored connector with a change applied: the fields a change leaves out keep their value. */
import type { connectorPatchSchema } from '@quanthea/shared';
import type { z } from 'zod';
import type { ConnectorRow } from '../db/connector-repository.ts';

/**
 * Applies a change to a stored connector, without its credentials.
 *
 * @param row - The stored connector.
 * @param patch - The change.
 * @param config - The validated configuration.
 * @param time - Now; the version always moves forward.
 * @returns The changed connector.
 */
export function patched(
  row: ConnectorRow,
  patch: z.output<typeof connectorPatchSchema>,
  config: unknown,
  time: number,
): Omit<ConnectorRow, 'secret'> {
  return {
    ...row,
    name: patch.name ?? row.name,
    config,
    accessLevel: patch.accessLevel ?? row.accessLevel,
    hiddenFields: patch.hiddenFields ?? row.hiddenFields,
    visibility: patch.visibility ?? row.visibility,
    bucketScripts: patch.bucketScripts ?? row.bucketScripts,
    guardrails: patch.guardrails ?? row.guardrails,
    descriptions: patch.descriptions ?? row.descriptions,
    updatedAt: Math.max(time, row.updatedAt + 1),
  };
}
