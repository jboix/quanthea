/** A conversation about a dashboard in the bin, with Restore and, for admins, Delete for good. */
import { type BinnedConversation, dayMonthTime } from '@quanthea/shared';
import { Button } from '../../ui/button.tsx';
import styles from './bin.module.css';
import { ConfirmButton, purgeNote, useBinIntent, useIsAdmin } from './bin-parts.tsx';

/**
 * One binned conversation: its dashboard and first question, who started it, how many questions
 * it holds, who binned it and when, and when it goes for good.
 *
 * @param props - The conversation and the retention.
 * @param props.conversation - The binned conversation.
 * @param props.binDays - How many days the bin keeps it, or `null`.
 * @returns The row.
 */
export function ConversationBinRow({
  conversation,
  binDays,
}: {
  readonly conversation: BinnedConversation;
  readonly binDays: number | null;
}) {
  const admin = useIsAdmin();
  const { submit, busy, failure } = useBinIntent();
  const when = dayMonthTime(conversation.binnedAt, Date.now());
  const count = `${conversation.count} ${conversation.count === 1 ? 'question' : 'questions'}`;
  const conversationId = conversation.id;
  return (
    <li className={styles.row} data-busy={busy}>
      <div className={styles.what}>
        <span className={styles.title}>
          Conversation on <em>{conversation.dashboardTitle}</em>: {conversation.question}
        </span>
        <span className={styles.meta}>
          Started by {conversation.startedBy} · {count} · deleted {when} by {conversation.binnedBy}
          {purgeNote(conversation.binnedAt, binDays)}
        </span>
        {failure && <span className={styles.failure}>{failure}</span>}
      </div>
      <div className={styles.actions}>
        <Button
          disabled={busy}
          onClick={() => submit({ intent: 'restore-conversation', conversationId })}
        >
          Restore
        </Button>
        {admin && (
          <ConfirmButton
            label="Delete for good"
            question="The conversation and its answers go for good."
            disabled={busy}
            onConfirm={() => submit({ intent: 'purge-conversation', conversationId })}
          />
        )}
      </div>
    </li>
  );
}
