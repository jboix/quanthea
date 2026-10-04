/** Submits the notifications screen's intents through a fetcher of their own. */
import { type SubmitTarget, useFetcher } from 'react-router';
import type { NotificationsIntent, NotificationsOutcome } from './data.ts';

/** What {@link useNotificationsIntent} returns. */
export interface IntentFetcher {
  /** Submits an intent. */
  readonly submit: (intent: NotificationsIntent) => void;
  /** Whether one is on its way. */
  readonly busy: boolean;
  /** The last outcome, if any. */
  readonly outcome: NotificationsOutcome | undefined;
}

/**
 * Submits notifications intents, and keeps the last outcome.
 *
 * @returns The submit function, whether one is on its way, and the outcome.
 */
export function useNotificationsIntent(): IntentFetcher {
  const fetcher = useFetcher<NotificationsOutcome>();
  const submit = (intent: NotificationsIntent) =>
    void fetcher.submit(intent as unknown as SubmitTarget, {
      method: 'post',
      encType: 'application/json',
    });
  return { submit, busy: fetcher.state !== 'idle', outcome: fetcher.data };
}
