/**
 * The access a gated result was read at, and whether a connector's access restricts it now. An
 * access change applies to new tool calls only: data already in a thread is re-sent with it, so
 * the threads holding data that a change restricts are counted before it is saved, and flagged.
 */
import { type AccessLevel, type SourceAccess, sourceAccessSchema } from '@quanthea/shared';
import type { GateSubject } from './subject.ts';

/** What decides what the model may see of a connector: its level and its hidden fields. */
export interface AccessSettings {
  /** The access level. */
  readonly accessLevel: AccessLevel;
  /** The hidden fields, as the admin wrote them. */
  readonly hiddenFields: readonly string[];
}

/** A thread's record of the access one of its results was read at, as stored. */
export interface RecordedAccess {
  /** The thread. */
  readonly threadId: string;
  /** The record, unchecked: a {@link SourceAccess} when it is valid. */
  readonly access: unknown;
}

/**
 * A short fingerprint of a hidden field, so a thread records which fields were hidden without
 * holding their names. Names compare without case, as the gate compares them.
 *
 * @param entry - The hidden field.
 * @returns The fingerprint, 16 hexadecimal digits.
 */
function fingerprint(entry: string): string {
  const hasher = new Bun.CryptoHasher('sha256');
  return hasher.update(entry.trim().toLowerCase()).digest('hex').slice(0, 16);
}

/**
 * The access a result of a connector is read at now.
 *
 * @param subject - The connector, as the gate sees it.
 * @returns Its id, level and hidden fields' fingerprints.
 */
export function sourceAccessOf(subject: GateSubject): SourceAccess {
  return {
    connectorId: subject.id,
    level: subject.accessLevel,
    hidden: [...new Set(subject.hiddenFields.map(fingerprint))],
  };
}

/**
 * Whether settings restrict a result read at a recorded access: the level is lower, or a field
 * is hidden that was not.
 *
 * @param recorded - The access the result was read at.
 * @param settings - The connector's settings, current or proposed.
 * @returns `true` when the result holds data the settings would not let through.
 */
export function narrowsAccess(recorded: SourceAccess, settings: AccessSettings): boolean {
  if (settings.accessLevel < recorded.level) return true;
  const known = new Set(recorded.hidden);
  return settings.hiddenFields.some((entry) => !known.has(fingerprint(entry)));
}

/**
 * The valid records among stored ones.
 *
 * @param rows - The stored records.
 * @returns Each valid record with its thread.
 */
function validRecords(rows: readonly RecordedAccess[]) {
  return rows.flatMap(({ threadId, access }) => {
    const parsed = sourceAccessSchema.safeParse(access);
    return parsed.success ? [{ threadId, access: parsed.data }] : [];
  });
}

/**
 * The threads holding a result that a connector's current settings restrict.
 *
 * @param rows - The stored records.
 * @param settingsOf - A connector's current settings by id; `undefined` once it is gone.
 * @returns The threads' ids.
 */
export function restrictedThreads(
  rows: readonly RecordedAccess[],
  settingsOf: (connectorId: string) => AccessSettings | undefined,
): Set<string> {
  const threads = new Set<string>();
  for (const { threadId, access } of validRecords(rows)) {
    const settings = settingsOf(access.connectorId);
    if (settings && narrowsAccess(access, settings)) threads.add(threadId);
  }
  return threads;
}

/**
 * How many threads hold a result of a connector that proposed settings would restrict.
 *
 * @param rows - The stored records.
 * @param connectorId - The connector.
 * @param proposed - The settings about to be saved.
 * @returns The number of threads.
 */
export function countNarrowedThreads(
  rows: readonly RecordedAccess[],
  connectorId: string,
  proposed: AccessSettings,
): number {
  return restrictedThreads(rows, (id) => (id === connectorId ? proposed : undefined)).size;
}
