/**
 * Access changes that restrict what the model sees of a connector. Such a change applies to new
 * tool calls only, so the form counts the threads holding data it restricts before saving it.
 */
import { type AccessChange, accessChangeSchema } from '@quanthea/shared';

/**
 * Whether a change restricts what the model sees: a lower level, or a field hidden that was not.
 * Names compare without case, as the server compares them.
 *
 * @param current - The connector's settings now.
 * @param next - The settings about to be saved.
 * @returns `true` when the change restricts.
 */
export function narrowsAccess(current: AccessChange, next: AccessChange): boolean {
  if (next.accessLevel < current.accessLevel) return true;
  const known = new Set(current.hiddenFields.map((field) => field.trim().toLowerCase()));
  return next.hiddenFields.some((field) => !known.has(field.trim().toLowerCase()));
}

/**
 * The resource route that counts the threads a change restricts.
 *
 * @param connectorId - The connector.
 * @param change - The settings about to be saved.
 * @returns The path, with the change in its query.
 */
export function affectedThreadsPath(connectorId: string, change: AccessChange): string {
  const search = new URLSearchParams({ accessLevel: String(change.accessLevel) });
  for (const field of change.hiddenFields) search.append('hidden', field);
  return `/connectors/${connectorId}/affected-threads?${search.toString()}`;
}

/**
 * Reads a change back from the query of {@link affectedThreadsPath}.
 *
 * @param search - The query.
 * @returns The change, or `undefined` when the query holds none.
 */
export function accessChangeOf(search: URLSearchParams): AccessChange | undefined {
  return accessChangeSchema.safeParse({
    accessLevel: Number(search.get('accessLevel')),
    hiddenFields: search.getAll('hidden'),
  }).data;
}

/**
 * The warning shown before saving a change that restricts data threads already hold.
 *
 * @param threads - How many threads hold it.
 * @returns The warning.
 */
export function affectedThreadsWarning(threads: number): string {
  const holds = threads === 1 ? '1 thread holds' : `${threads} threads hold`;
  return `${holds} data from this connector that this change restricts. The change applies to new tool calls only: continuing such a thread resends that data to the model provider.`;
}

/**
 * The warning shown before saving a change that restricts what the model sees, when the threads
 * it affects could not be counted.
 *
 * @param failure - Why they could not be counted.
 * @returns The warning.
 */
export function uncountedWarning(failure: string): string {
  const reason = failure.trim().replace(/\.$/, '');
  return `The threads this change affects could not be counted: ${reason}. Threads may hold data from this connector that this change restricts, and continuing such a thread resends that data to the model provider.`;
}
