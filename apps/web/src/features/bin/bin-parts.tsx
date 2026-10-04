/** What the rows of the bin share: who may delete for good, the intents, asking first, and dates. */
import { dayMonthYear, hasRole, type Role } from '@quanthea/shared';
import { useState } from 'react';
import { type SubmitTarget, useFetcher, useRouteLoaderData } from 'react-router';
import { Button } from '../../ui/button.tsx';
import styles from './bin.module.css';
import type { BinIntent, BinOutcome } from './data.ts';

/**
 * Whether the person is an admin, who may delete for good.
 *
 * @returns `true` for admins.
 */
export function useIsAdmin(): boolean {
  const session = useRouteLoaderData('root') as { principal: { role: Role } } | undefined;
  return session !== undefined && hasRole(session.principal.role, 'admin');
}

/**
 * Submits bin intents, and keeps the last outcome.
 *
 * @returns The submit function, whether one is on its way, and the last refusal.
 */
export function useBinIntent() {
  const fetcher = useFetcher<BinOutcome>();
  const submit = (intent: BinIntent) =>
    void fetcher.submit(intent as SubmitTarget, { method: 'post', encType: 'application/json' });
  const failure = fetcher.data?.ok === false ? fetcher.data.message : undefined;
  return { submit, busy: fetcher.state !== 'idle', failure };
}

/**
 * Two buttons that ask before an action that can't be undone.
 *
 * @param props - The button's words, the question, and the action.
 * @param props.label - The button's words.
 * @param props.question - What to ask.
 * @param props.onConfirm - Runs the action.
 * @param props.disabled - Whether the button is off.
 * @returns The button, or the question with Delete and Cancel.
 */
export function ConfirmButton({
  label,
  question,
  onConfirm,
  disabled,
}: {
  readonly label: string;
  readonly question: string;
  readonly onConfirm: () => void;
  readonly disabled: boolean;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button variant="danger" disabled={disabled} onClick={() => setAsking(true)}>
        {label}
      </Button>
    );
  }
  return (
    <span className={styles.confirm}>
      <span>{question}</span>
      <Button variant="danger" size="small" onClick={onConfirm}>
        Delete
      </Button>
      <Button size="small" onClick={() => setAsking(false)}>
        Cancel
      </Button>
    </span>
  );
}

/** A day, in milliseconds. */
const dayMs = 86_400_000;

/**
 * When something binned is deleted for good.
 *
 * @param binnedAt - When it went to the bin, in epoch milliseconds.
 * @param binDays - How many days the bin keeps it, or `null`.
 * @returns Such as ` · deleted for good after 3 Nov 2026`, or nothing when it is kept.
 */
export function purgeNote(binnedAt: number, binDays: number | null): string {
  if (binDays === null) return '';
  const on = dayMonthYear(binnedAt + binDays * dayMs);
  return ` · deleted for good after ${on}`;
}
