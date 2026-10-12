/**
 * Saves what a connector shows, first counting the threads and pinned dashboards that read an
 * object the change hides. With any to warn about, the change waits for the admin to confirm it.
 */
import type { ConnectorDetail, ObjectVisibility } from '@quanthea/shared';
import { useEffect, useState } from 'react';
import { useFetcher } from 'react-router';
import type { CountedUsage } from './data.ts';
import { objectUsagePath, objectUsageWarning, uncountedUsageWarning } from './shown-objects.ts';
import { type ConnectorChange, useConnectorChange } from './use-connector-change.ts';

/** A section's channel for changing what a connector shows, with the warning before saving. */
export interface VisibilityGuard {
  /** The channel the change is saved through. */
  readonly change: ConnectorChange;
  /** Counts the dashboards a visibility hides an object from, then saves it or waits. */
  readonly propose: (visibility: ObjectVisibility) => void;
  /** Whether a change waits for its count or for confirmation. */
  readonly waiting: boolean;
  /** The warning of the waiting change, once counted or once the count failed. */
  readonly warning: string | undefined;
  /** Saves the waiting change. */
  readonly confirm: () => void;
  /** Drops the waiting change. */
  readonly cancel: () => void;
}

/** A visibility waiting for its count, and the query the count is asked with. */
interface Waiting {
  /** The visibility. */
  readonly visibility: ObjectVisibility;
  /** The query of its count. */
  readonly query: string;
}

/**
 * The count of the waiting change, once the fetcher holds the answer to its own query.
 *
 * @param waiting - The change waiting, if any.
 * @param data - The fetcher's latest result.
 * @returns The count or the failure, or `undefined` while it is not there.
 */
function countOf(waiting: Waiting | undefined, data: CountedUsage | undefined) {
  return waiting !== undefined && data?.query === waiting.query ? data : undefined;
}

/**
 * The warning for a count, when it has something to warn about.
 *
 * @param counted - The count or the failure.
 * @returns The warning, or `undefined` while counting or when nothing reads a hidden object.
 */
function warningOf(counted: CountedUsage | undefined): string | undefined {
  if (counted === undefined) return undefined;
  if ('failure' in counted) return uncountedUsageWarning(counted.failure);
  return counted.threads + counted.pinned > 0 ? objectUsageWarning(counted) : undefined;
}

/**
 * A channel for changing what a connector shows that warns before hiding an object that threads
 * or pinned dashboards read.
 *
 * @param connector - The connector.
 * @returns The channel.
 */
export function useVisibilityGuard(connector: ConnectorDetail): VisibilityGuard {
  const change = useConnectorChange(connector.id);
  const counter = useFetcher<CountedUsage>();
  const [waiting, setWaiting] = useState<Waiting>();
  const counted = countOf(waiting, counter.data);
  const warning = warningOf(counted);
  const unused = counted !== undefined && warning === undefined;
  useEffect(() => {
    if (!unused || waiting === undefined) return;
    change.submit({ intent: 'update', patch: { visibility: waiting.visibility } });
    setWaiting(undefined);
  }, [unused, waiting, change.submit]);
  const propose = (visibility: ObjectVisibility) => {
    const path = objectUsagePath(connector.id, visibility);
    setWaiting({ visibility, query: path.slice(path.indexOf('?')) });
    void counter.load(path);
  };
  const confirm = () => {
    if (waiting) change.submit({ intent: 'update', patch: { visibility: waiting.visibility } });
    setWaiting(undefined);
  };
  return {
    change,
    propose,
    waiting: waiting !== undefined,
    warning,
    confirm,
    cancel: () => setWaiting(undefined),
  };
}
