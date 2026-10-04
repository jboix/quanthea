import type { ChannelView } from '@quanthea/shared';
import { useCallback, useEffect, useState } from 'react';
import { useLoaderData } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Card } from '../../ui/card.tsx';
import { Dialog } from '../../ui/dialog.tsx';
import { Page } from '../../ui/page.tsx';
import { ChannelForm } from './channel-form.tsx';
import { ChannelRow, TestResult } from './channel-row.tsx';
import type { ChannelFields, NotificationsData } from './data.ts';
import styles from './notifications.module.css';
import { useNotificationsIntent } from './use-intent.ts';

/** The headers of a signed webhook request, as the example shows them. */
const exampleHeaders = [
  'POST /your/hook',
  'Content-Type: application/json',
  'X-Quanthea-Event: alert.firing',
  'X-Quanthea-Delivery: 01K…',
  'X-Quanthea-Timestamp: 1791116220',
  'X-Quanthea-Signature: sha256=5d0c…',
];

/** What the dialog shows: a new channel, or one being changed, each opening counted. */
type Editing = { readonly channel?: ChannelView; readonly opening: number } | null;

/**
 * Once a channel is added: say so, and offer a test.
 *
 * @param props - The channel.
 * @param props.channel - The channel just added.
 * @returns The panel.
 */
function AddedPanel({ channel }: { readonly channel: ChannelView }) {
  const { submit, busy, outcome } = useNotificationsIntent();
  const tested = outcome?.ok && 'test' in outcome ? outcome.test : undefined;
  return (
    <div className={styles.added}>
      <p>{channel.name} is added. Send a test to check that the message arrives as it should.</p>
      <Button
        variant="primary"
        disabled={busy}
        onClick={() => submit({ intent: 'test', channelId: channel.id })}
      >
        Send a test
      </Button>
      {tested && <TestResult result={tested} />}
    </div>
  );
}

/**
 * The dialog that adds or changes a channel, then offers a test of a new one.
 *
 * @param props - What it edits and how to close it.
 * @param props.editing - The channel being changed, a new one, or `null` when closed.
 * @param props.onClose - Closes it.
 * @returns The dialog.
 */
function ChannelDialog({
  editing,
  onClose,
}: {
  readonly editing: Editing;
  readonly onClose: () => void;
}) {
  const { submit, busy, outcome } = useNotificationsIntent();
  const channel = editing?.channel;
  const saved = outcome?.ok && 'channel' in outcome ? outcome.channel : undefined;
  const issues = outcome?.ok === false ? outcome.issues : {};
  const title = channel ? `Edit ${channel.name}` : 'Add a channel';
  const save = (fields: ChannelFields) =>
    submit(
      channel ? { intent: 'update', channelId: channel.id, fields } : { intent: 'create', fields },
    );
  const changed = saved !== undefined && channel !== undefined;
  useEffect(() => {
    if (changed) onClose();
  }, [changed, onClose]);
  return (
    <Dialog title={title} open={editing !== null} onClose={onClose}>
      {saved && !channel ? (
        <AddedPanel channel={saved} />
      ) : (
        <>
          {outcome?.ok === false && Object.keys(issues).length === 0 && (
            <p className={styles.failed}>{outcome.message}</p>
          )}
          <ChannelForm channel={channel} busy={busy} issues={issues} onSubmit={save} />
        </>
      )}
    </Dialog>
  );
}

/**
 * The example of what a generic webhook receives.
 *
 * @param props - The example body.
 * @param props.example - The body, for the sample message.
 * @returns The card.
 */
function WebhookExample({ example }: { readonly example: unknown }) {
  const request = [...exampleHeaders, '', JSON.stringify(example, null, 2)].join('\n');
  return (
    <Card
      title="What a webhook receives"
      description="A POST of JSON. With a signing secret, the signature is the hex HMAC-SHA-256 of the timestamp, a dot and the body. Refuse an old timestamp to refuse a replay."
    >
      <pre className={styles.example}>{request}</pre>
      <p className={styles.quiet}>Events: alert.firing, alert.resolved and alert.test.</p>
    </Card>
  );
}

/**
 * Settings → Notifications: the channels alerts send to, a form to add and change them, tests,
 * and an example of what the generic webhook receives.
 *
 * @returns The screen.
 */
export function NotificationsScreen() {
  const { channels, webhookExample } = useLoaderData() as NotificationsData;
  const [editing, setEditing] = useState<Editing>(null);
  const [opening, setOpening] = useState(0);
  const open = (channel?: ChannelView) => {
    setOpening(opening + 1);
    setEditing(channel ? { channel, opening } : { opening });
  };
  const close = useCallback(() => setEditing(null), []);
  const add = (
    <Button variant="primary" onClick={() => open()}>
      Add a channel
    </Button>
  );
  return (
    <Page
      title="Notifications"
      subtitle="Alerts send to these channels. A message leaves quanthea when it is sent, so only admins add channels."
      actions={add}
    >
      <div className={styles.layout}>
        <Card title={channels.length === 1 ? '1 channel' : `${channels.length} channels`}>
          {channels.length === 0 ? (
            <p className={styles.quiet}>No channels yet. Add one, then send it a test.</p>
          ) : (
            <ul className={styles.list}>
              {channels.map((channel) => (
                <ChannelRow key={channel.id} channel={channel} onEdit={() => open(channel)} />
              ))}
            </ul>
          )}
        </Card>
        <WebhookExample example={webhookExample} />
      </div>
      <ChannelDialog key={editing?.opening ?? 'closed'} editing={editing} onClose={close} />
    </Page>
  );
}
