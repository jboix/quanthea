/** Submits a change to the alert page's action, one fetcher shared by its menus. */
import { type SubmitTarget, useFetcher } from 'react-router';
import type { AlertIntent, AlertOutcome } from './data.ts';

/** The key of the fetcher the menus share, so the page shows the last refusal. */
const changeKey = 'alert-change';

/** What a menu needs to change the alert. */
export interface AlertChange {
  /** Submits an intent. */
  readonly submit: (intent: AlertIntent) => void;
  /** Whether a change is on its way. */
  readonly busy: boolean;
  /** Why the last change was refused, if it was. */
  readonly refusal: string | undefined;
}

/**
 * The alert page's change fetcher.
 *
 * @returns The submitter, whether it is busy, and the last refusal.
 */
export function useAlertChange(): AlertChange {
  const fetcher = useFetcher<AlertOutcome>({ key: changeKey });
  const submit = (intent: AlertIntent) =>
    void fetcher.submit(intent as SubmitTarget, { method: 'post', encType: 'application/json' });
  const refusal = fetcher.data?.ok === false ? fetcher.data.message : undefined;
  return { submit, busy: fetcher.state !== 'idle', refusal };
}
