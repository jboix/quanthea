/**
 * Saves an access change, first counting the threads it restricts when it restricts what the
 * model sees. With threads to warn about, the change waits for the admin to confirm it.
 */
import type { AccessChange, ConnectorDetail } from '@quanthea/shared';
import { useEffect, useState } from 'react';
import { useFetcher } from 'react-router';
import { affectedThreadsPath, narrowsAccess } from './access-change.ts';
import type { AffectedThreads } from './data.ts';
import { type ConnectorChange, useConnectorChange } from './use-connector-change.ts';

/** A change to the level or the hidden fields. */
type AccessPatch = Partial<AccessChange>;

/** A section's channel for changing a connector's access, with the warning before saving. */
export interface AccessGuard {
  /** The channel the change is saved through. */
  readonly change: ConnectorChange;
  /** Saves a change, or counts the threads it restricts first. */
  readonly propose: (patch: AccessPatch) => void;
  /** The change waiting for confirmation, if any. */
  readonly proposed: AccessPatch | undefined;
  /** How many threads the waiting change restricts, once counted. */
  readonly threads: number | undefined;
  /** Saves the waiting change. */
  readonly confirm: () => void;
  /** Drops the waiting change. */
  readonly cancel: () => void;
}

/** A change waiting for its count, and the query the count is asked with. */
interface Waiting {
  /** The change. */
  readonly patch: AccessPatch;
  /** The query of its count. */
  readonly query: string;
}

/**
 * The count of a waiting change, once the fetcher has it.
 *
 * @param waiting - The change waiting, if any.
 * @param data - The fetcher's latest count.
 * @returns The number of threads, when the count is the waiting change's.
 */
function countOf(waiting: Waiting | undefined, data: AffectedThreads | undefined) {
  return waiting !== undefined && data?.query === waiting.query ? data.threads : undefined;
}

/**
 * A channel for changing a connector's level or hidden fields that warns before restricting data
 * that threads already hold.
 *
 * @param connector - The connector.
 * @returns The channel.
 */
export function useAccessGuard(connector: ConnectorDetail): AccessGuard {
  const change = useConnectorChange(connector.id);
  const counter = useFetcher<AffectedThreads>();
  const [waiting, setWaiting] = useState<Waiting>();
  const threads = countOf(waiting, counter.data);
  const save = (patch: AccessPatch) => change.submit({ intent: 'update', patch });
  useEffect(() => {
    if (threads !== 0 || waiting === undefined) return;
    change.submit({ intent: 'update', patch: waiting.patch });
    setWaiting(undefined);
  }, [threads, waiting, change.submit]);
  const propose = (patch: AccessPatch) => {
    const next = { accessLevel: connector.accessLevel, hiddenFields: connector.hiddenFields };
    if (!narrowsAccess(next, { ...next, ...patch })) return save(patch);
    const path = affectedThreadsPath(connector.id, { ...next, ...patch });
    setWaiting({ patch, query: path.slice(path.indexOf('?')) });
    void counter.load(path);
  };
  const confirm = () => {
    if (waiting) save(waiting.patch);
    setWaiting(undefined);
  };
  const cancel = () => setWaiting(undefined);
  return { change, propose, proposed: waiting?.patch, threads, confirm, cancel };
}
