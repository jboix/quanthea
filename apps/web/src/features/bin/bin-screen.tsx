import { type BinnedThread, dayMonthTime } from '@quanthea/shared';
import { Fragment, useCallback, useState } from 'react';
import { useLoaderData } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Page } from '../../ui/page.tsx';
import styles from './bin.module.css';
import { ConfirmButton, purgeNote, useBinIntent, useIsAdmin } from './bin-parts.tsx';
import { ConversationBinRow } from './conversation-row.tsx';
import type { BinData } from './data.ts';
import { RetentionDialog } from './retention-dialog.tsx';

/**
 * One binned thread: what it was, when it went to the bin and when it goes for good, and Restore
 * or Delete for good.
 *
 * @param props - The thread and the retention.
 * @param props.thread - The binned thread.
 * @param props.binDays - How many days the bin keeps a thread, or `null`.
 * @returns The row.
 */
function BinRow({
  thread,
  binDays,
}: {
  readonly thread: BinnedThread;
  readonly binDays: number | null;
}) {
  const admin = useIsAdmin();
  const { submit, busy, failure } = useBinIntent();
  const when = dayMonthTime(thread.deletedAt, Date.now());
  const title = thread.title ?? 'Untitled thread';
  return (
    <li className={styles.row} data-busy={busy}>
      <div className={styles.what}>
        <span className={styles.title}>{title}</span>
        <span className={styles.meta}>
          {thread.ownerName ? `${thread.ownerName}’s · ` : ''}
          {thread.dashboardTitle ? `Dashboard: ${thread.dashboardTitle} · ` : 'No dashboard · '}
          deleted {when}
          {thread.deletedBy ? ` by ${thread.deletedBy}` : ''}
          {purgeNote(thread.deletedAt, binDays)}
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
 * How long threads stay.
 *
 * @param props - The retention.
 * @param props.binDays - How many days the bin keeps a thread, or `null`.
 * @returns The subtitle.
 */
function BinSubtitle({ binDays }: { readonly binDays: number | null }) {
  const stay = binDays === null ? 'until someone deletes them' : `for ${binDays} days`;
  return (
    <>
      Deleted threads, with their dashboards, and deleted conversations about dashboards wait here{' '}
      {stay}. Deleting one for good frees its space; usage is kept.
    </>
  );
}

/**
 * What admins can do with the whole bin: set the retention, and empty it.
 *
 * @param props - The bin.
 * @param props.data - The bin.
 * @returns The buttons, and the retention dialog.
 */
function AdminActions({ data }: { readonly data: BinData }) {
  const empty = useBinIntent();
  const [retention, setRetention] = useState(false);
  const close = useCallback(() => setRetention(false), []);
  const count = data.threads.length + data.conversations.length;
  return (
    <div className={styles.headerActions}>
      <Button onClick={() => setRetention(true)}>Retention</Button>
      {count > 0 && (
        <ConfirmButton
          label="Empty bin"
          question={`Delete ${count === 1 ? 'it' : `all ${count}`} for good?`}
          disabled={empty.busy}
          onConfirm={() => empty.submit({ intent: 'empty' })}
        />
      )}
      {empty.failure && <p className={styles.failure}>{empty.failure}</p>}
      <RetentionDialog
        binDays={data.binDays}
        managedBy={data.retentionManagedBy}
        open={retention}
        onClose={close}
      />
    </div>
  );
}

/**
 * The binned threads and conversations, the most recently binned first.
 *
 * @param props - The bin.
 * @param props.data - The bin.
 * @returns The list.
 */
function BinList({ data }: { readonly data: BinData }) {
  const { binDays } = data;
  const rows = [
    ...data.threads.map((thread) => ({
      at: thread.deletedAt,
      key: `thread-${thread.id}`,
      row: <BinRow thread={thread} binDays={binDays} />,
    })),
    ...data.conversations.map((conversation) => ({
      at: conversation.binnedAt,
      key: `conversation-${conversation.id}`,
      row: <ConversationBinRow conversation={conversation} binDays={binDays} />,
    })),
  ].sort((one, other) => other.at - one.at);
  return (
    <ul className={styles.list}>
      {rows.map(({ key, row }) => (
        <Fragment key={key}>{row}</Fragment>
      ))}
    </ul>
  );
}

/**
 * The bin: deleted threads with their dashboards, and deleted conversations about dashboards,
 * until someone restores them or they are deleted for good. Usage stays in Settings → Usage either
 * way.
 *
 * @returns The screen.
 */
export function BinScreen() {
  const data = useLoaderData() as BinData;
  const admin = useIsAdmin();
  const empty = data.threads.length === 0 && data.conversations.length === 0;
  return (
    <Page
      title="Bin"
      subtitle={<BinSubtitle binDays={data.binDays} />}
      actions={admin && <AdminActions data={data} />}
    >
      {empty ? <p className={styles.empty}>The bin is empty.</p> : <BinList data={data} />}
    </Page>
  );
}
