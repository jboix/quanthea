import {
  type ChannelSend,
  type ChannelView,
  channelKindInfo,
  type SendResult,
} from '@quanthea/shared';
import { useState } from 'react';
import { Button } from '../../ui/button.tsx';
import { Pill } from '../../ui/pill.tsx';
import { StatusDot } from '../../ui/status-dot.tsx';
import styles from './notifications.module.css';
import { useNotificationsIntent } from './use-intent.ts';

/**
 * A time in words, short.
 *
 * @param at - Epoch milliseconds.
 * @returns The day and time.
 */
export function whenWords(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * A channel's status: its last send, or its last failure when that is newer.
 *
 * @param props - The channel.
 * @param props.channel - The channel.
 * @returns The status line.
 */
function ChannelStatus({ channel }: { readonly channel: ChannelView }) {
  const { lastSentAt, lastError } = channel;
  if (lastError && lastError.at >= (lastSentAt ?? 0)) {
    const status = lastError.status === null ? '' : ` · ${lastError.status}`;
    return (
      <span className={styles.failed} title={lastError.message}>
        <StatusDot status="failed" label="Last send failed" /> failed {whenWords(lastError.at)}
        {status}
      </span>
    );
  }
  if (lastSentAt === null)
    return (
      <span className={styles.quiet}>
        <StatusDot status="unknown" label="Nothing sent yet" /> nothing sent yet
      </span>
    );
  return (
    <span className={styles.sent}>
      <StatusDot status="ok" label="Last send got through" /> last sent {whenWords(lastSentAt)}
    </span>
  );
}

/**
 * How a test went.
 *
 * @param props - The result.
 * @param props.result - The test's result.
 * @returns The line.
 */
export function TestResult({ result }: { readonly result: SendResult }) {
  if (result.ok)
    return <p className={styles.sent}>The test got through in {result.attempts} attempt(s).</p>;
  return <p className={styles.failed}>The test failed: {result.error}</p>;
}

/**
 * A channel's recent sends.
 *
 * @param props - The sends.
 * @param props.sends - The newest first.
 * @returns The list.
 */
function SendList({ sends }: { readonly sends: readonly ChannelSend[] }) {
  if (sends.length === 0) return <p className={styles.quiet}>Nothing sent yet.</p>;
  return (
    <ul className={styles.sends}>
      {sends.map((send) => (
        <li key={send.id}>
          <StatusDot status={send.ok ? 'ok' : 'failed'} label={send.ok ? 'Sent' : 'Failed'} />
          <span>{whenWords(send.at)}</span>
          <code>{send.event}</code>
          <span className={styles.quiet}>
            {send.httpStatus ?? 'no answer'} · {send.attempts} attempt(s)
          </span>
          {send.error && <span className={styles.failed}>{send.error}</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * What came back from the row's last intent: a test, the sends, or a refusal.
 *
 * @param props - The outcome.
 * @param props.outcome - The last outcome, if any.
 * @returns The panel under the row, or nothing.
 */
function RowOutcome({
  outcome,
}: {
  readonly outcome: ReturnType<typeof useNotificationsIntent>['outcome'];
}) {
  if (!outcome) return null;
  if (!outcome.ok) return <p className={styles.failed}>{outcome.message}</p>;
  if ('test' in outcome) return <TestResult result={outcome.test} />;
  if ('sends' in outcome) return <SendList sends={outcome.sends} />;
  return null;
}

/**
 * Delete, asked twice. A channel alerts send to can't be deleted.
 *
 * @param props - The channel and the delete handler.
 * @param props.channel - The channel.
 * @param props.onDelete - Deletes it.
 * @param props.busy - Whether an intent is on its way.
 * @returns The button.
 */
function DeleteButton({
  channel,
  onDelete,
  busy,
}: {
  readonly channel: ChannelView;
  readonly onDelete: () => void;
  readonly busy: boolean;
}) {
  const [asked, setAsked] = useState(false);
  const used = channel.alerts > 0;
  const title = used ? 'Alerts send to this channel. Take it off them first.' : undefined;
  return (
    <Button
      size="small"
      variant="danger"
      title={title}
      disabled={busy || used}
      onClick={() => (asked ? onDelete() : setAsked(true))}
      onBlur={() => setAsked(false)}
    >
      {asked ? 'Delete for good' : 'Delete'}
    </Button>
  );
}

/**
 * One channel: name, kind, masked target, status, alerts using it, and what an admin can do.
 *
 * @param props - The channel and the edit handler.
 * @param props.channel - The channel.
 * @param props.onEdit - Opens the edit form.
 * @returns The row.
 */
export function ChannelRow({
  channel,
  onEdit,
}: {
  readonly channel: ChannelView;
  readonly onEdit: () => void;
}) {
  const { submit, busy, outcome } = useNotificationsIntent();
  const channelId = channel.id;
  const alerts = channel.alerts === 1 ? '1 alert' : `${channel.alerts} alerts`;
  return (
    <li className={styles.row}>
      <div className={styles.rowMain}>
        <span className={styles.what}>
          <span className={styles.name}>
            {channel.name} <Pill shape="tag">{channelKindInfo[channel.kind].label}</Pill>
          </span>
          <span className={styles.target}>{channel.target}</span>
        </span>
        <ChannelStatus channel={channel} />
        <span className={styles.quiet}>{alerts}</span>
      </div>
      <div className={styles.actions}>
        <Button size="small" disabled={busy} onClick={() => submit({ intent: 'test', channelId })}>
          Send a test
        </Button>
        <Button size="small" disabled={busy} onClick={() => submit({ intent: 'sends', channelId })}>
          Recent sends
        </Button>
        <Button size="small" disabled={busy} onClick={onEdit}>
          Edit
        </Button>
        <DeleteButton
          channel={channel}
          busy={busy}
          onDelete={() => submit({ intent: 'delete', channelId })}
        />
      </div>
      <RowOutcome outcome={outcome} />
    </li>
  );
}
