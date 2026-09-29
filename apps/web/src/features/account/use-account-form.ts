/** Submits an account form as JSON, and loads the next page in full once it succeeds. */
import { useEffect } from 'react';
import { type SubmitTarget, useFetcher } from 'react-router';
import type { AccountOutcome } from './data.ts';

/**
 * A form that posts JSON to a route action and, on success, loads the next page in full so the
 * session is read afresh.
 *
 * @param action - The route the form posts to.
 * @returns The submit function, whether it is on its way, and the refusal, if any.
 */
export function useAccountForm(action: string) {
  const fetcher = useFetcher<AccountOutcome>();
  const outcome = fetcher.data;
  useEffect(() => {
    if (outcome?.ok) window.location.assign(outcome.next);
  }, [outcome]);
  return {
    submit: (body: Record<string, string>) =>
      void fetcher.submit(body as SubmitTarget, {
        method: 'post',
        action,
        encType: 'application/json',
      }),
    busy: fetcher.state !== 'idle' || outcome?.ok === true,
    refusal: outcome?.ok === false ? outcome : undefined,
  };
}
