/**
 * Delete all my drafts, in the past threads drawer while it shows the drafts: it asks, in a
 * dialog that says how many, then moves every draft of the person to the bin at once. The server
 * applies the bin's rules again and never touches others' threads.
 */
import { useCallback, useEffect, useState } from 'react';
import { type SubmitTarget, useFetcher } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Dialog } from '../../ui/dialog.tsx';
import type { ThreadOutcome } from './data.ts';
import type { NewThreadIntent } from './new-thread-data.ts';
import { binDraftsQuestion } from './thread-list.ts';
import styles from './threads-drawer.module.css';

/**
 * The question and its two answers. It closes once the drafts are in the bin.
 *
 * @param props - How many drafts, and the close handler.
 * @param props.count - How many drafts the person has.
 * @param props.onClose - Closes the dialog.
 * @returns The confirmation.
 */
function ConfirmDrafts({
  count,
  onClose,
}: {
  readonly count: number;
  readonly onClose: () => void;
}) {
  const fetcher = useFetcher<ThreadOutcome>();
  useEffect(() => {
    if (fetcher.data?.ok) onClose();
  }, [fetcher.data, onClose]);
  const intent: NewThreadIntent = { intent: 'binDrafts' };
  const confirm = () =>
    void fetcher.submit(intent as SubmitTarget, { method: 'post', encType: 'application/json' });
  return (
    <div className={styles.binDrafts}>
      <p>{binDraftsQuestion(count)}</p>
      {fetcher.data?.ok === false && <p className={styles.failure}>{fetcher.data.message}</p>}
      <div className={styles.binDraftsActions}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="danger" disabled={fetcher.state !== 'idle'} onClick={confirm}>
          Move to the bin
        </Button>
      </div>
    </div>
  );
}

/**
 * The button and its dialog.
 *
 * @param props - How many drafts the person has.
 * @param props.count - How many of their own threads are drafts.
 * @returns The button, disabled without drafts, and the dialog.
 */
export function BinDrafts({ count }: { readonly count: number }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <div className={styles.binDraftsBar}>
        <Button size="small" variant="danger" disabled={count === 0} onClick={() => setOpen(true)}>
          Delete all my drafts
        </Button>
      </div>
      <Dialog title="Delete all my drafts" open={open} onClose={close}>
        <ConfirmDrafts count={count} onClose={close} />
      </Dialog>
    </>
  );
}
