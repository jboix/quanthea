/**
 * Moving a conversation about the dashboard to the bin: from the Ask tab's bar and from its row in
 * History. Whoever started it, and admins, may; it asks first, and the bin can restore it.
 */
import { useEffect, useRef } from 'react';
import { useFetcher } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { BinIcon } from '../../ui/icons.tsx';
import styles from './history.module.css';
import type { Loaded } from './loaded.ts';

/**
 * Moves conversations to the bin, and tells when one went.
 *
 * @param base - The page the conversations' resource routes are under: `/d/<id>`, or a run's path.
 * @param onBinned - Called with the conversation once it is in the bin.
 * @returns The bin function, whether one is on its way, and the last refusal.
 */
export function useBinConversation(base: string, onBinned: (conversationId: string) => void) {
  const fetcher = useFetcher<Loaded<{ binned: true }>>();
  const sent = useRef<string | undefined>(undefined);
  const { data, state } = fetcher;
  useEffect(() => {
    if (state !== 'idle' || !data?.ok || sent.current === undefined) return;
    onBinned(sent.current);
    sent.current = undefined;
  }, [data, state, onBinned]);
  const bin = (conversationId: string) => {
    sent.current = conversationId;
    const action = `${base}/conversations/${encodeURIComponent(conversationId)}`;
    void fetcher.submit(null, { method: 'delete', action });
  };
  const failure = data?.ok === false ? data.message : undefined;
  return { bin, busy: state !== 'idle', failure };
}

/**
 * Asks before moving a conversation to the bin.
 *
 * @param props - The question that names it, and the callbacks.
 * @param props.question - Its first question.
 * @param props.onConfirm - Moves it to the bin.
 * @param props.onCancel - Keeps it.
 * @returns The question and its buttons.
 */
export function ConfirmBin({
  question,
  onConfirm,
  onCancel,
}: {
  readonly question: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <div className={styles.confirm}>
      <span>Move “{question}” to the bin? You can restore it from there.</span>
      <Button size="small" variant="danger" onClick={onConfirm}>
        Move to bin
      </Button>
      <Button size="small" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

/**
 * The icon button that asks to move a conversation to the bin.
 *
 * @param props - The question that names it, and the click callback.
 * @param props.question - Its first question.
 * @param props.onClick - Asks before binning.
 * @returns The button.
 */
export function BinButton({
  question,
  onClick,
}: {
  readonly question: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.bin}
      aria-label={`Move ${question} to the bin`}
      title="Move to the bin"
      onClick={onClick}
    >
      <BinIcon />
    </button>
  );
}
