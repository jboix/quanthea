import { type BinnedThread, hasRole, type Role } from '@querent/shared';
import { useState } from 'react';
import { type SubmitTarget, useFetcher, useLoaderData, useRouteLoaderData } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Page } from '../../ui/page.tsx';
import styles from './bin.module.css';
import type { BinData, BinIntent, BinOutcome } from './data.ts';

/**
 * Whether the person is an admin, who may delete for good.
 *
 * @returns `true` for admins.
 */
function useIsAdmin(): boolean {
  const session = useRouteLoaderData('root') as { principal: { role: Role } } | undefined;
  return session !== undefined && hasRole(session.principal.role, 'admin');
}

/**
 * Submits bin intents, and keeps the last outcome.
 *
 * @returns The submit function, whether one is on its way, and the last refusal.
 */
function useBinIntent() {
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
function ConfirmButton({
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

/**
 * One binned thread: what it was, when it went to the bin, and Restore or Delete for good.
 *
 * @param props - The thread.
 * @param props.thread - The binned thread.
 * @returns The row.
 */
function BinRow({ thread }: { readonly thread: BinnedThread }) {
  const admin = useIsAdmin();
  const { submit, busy, failure } = useBinIntent();
  const when = new Date(thread.deletedAt).toLocaleString();
  const title = thread.title ?? 'Untitled thread';
  return (
    <li className={styles.row} data-busy={busy}>
      <div className={styles.what}>
        <span className={styles.title}>{title}</span>
        <span className={styles.meta}>
          {thread.dashboardTitle ? `Dashboard: ${thread.dashboardTitle} · ` : 'No dashboard · '}
          deleted {when}
          {thread.deletedBy ? ` by ${thread.deletedBy}` : ''}
        </span>
        {failure && <span className={styles.failure}>{failure}</span>}
      </div>
      <div className={styles.actions}>
        <Button disabled={busy} onClick={() => submit({ intent: 'restore', threadId: thread.id })}>
          Restore
        </Button>
        {admin && (
          <ConfirmButton
            label="Delete for good"
            question="The thread and its dashboard go for good."
            disabled={busy}
            onConfirm={() => submit({ intent: 'purge', threadId: thread.id })}
          />
        )}
      </div>
    </li>
  );
}

/**
 * The bin: deleted threads with their dashboards, until someone restores them or they are
 * deleted for good. Usage stays in Settings → Usage either way.
 *
 * @returns The screen.
 */
export function BinScreen() {
  const { threads } = useLoaderData() as BinData;
  const admin = useIsAdmin();
  const empty = useBinIntent();
  return (
    <Page
      title="Bin"
      subtitle="Deleted threads wait here with their dashboards. Deleting one for good frees its space; usage is kept."
      actions={
        admin &&
        threads.length > 0 && (
          <ConfirmButton
            label="Empty bin"
            question={`Delete ${threads.length === 1 ? 'this thread' : `all ${threads.length} threads`} for good?`}
            disabled={empty.busy}
            onConfirm={() => empty.submit({ intent: 'empty' })}
          />
        )
      }
    >
      {empty.failure && <p className={styles.failure}>{empty.failure}</p>}
      {threads.length === 0 ? (
        <p className={styles.empty}>The bin is empty.</p>
      ) : (
        <ul className={styles.list}>
          {threads.map((thread) => (
            <BinRow key={thread.id} thread={thread} />
          ))}
        </ul>
      )}
    </Page>
  );
}
