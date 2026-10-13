/**
 * Whom the draft notifies and what they would see: the channels, when they hear, when the alert
 * is quiet, a preview per channel filled with a firing from the replay, and the message template
 * to edit by hand.
 */
import type { AlertSpec, DefaultQuietHours, MessageTemplate } from '@quanthea/shared';
import { useState } from 'react';
import { Button } from '../../ui/button.tsx';
import styles from './alert-draft.module.css';
import { ChannelPreview } from './channel-preview.tsx';
import { durationWords } from './condition.ts';
import type { ChannelChoice, PreviewOutcome } from './data.ts';
import { quietSummary } from './quiet-hours.ts';
import { TemplateEditor } from './template-editor.tsx';

/** Props of {@link Notifies}. */
interface NotifiesProps {
  /** The draft's spec. */
  readonly spec: AlertSpec;
  /** Every channel, to name the draft's. */
  readonly channels: readonly ChannelChoice[];
  /** What each kind would send, once loaded. */
  readonly previews: PreviewOutcome | undefined;
  /** The quiet hours of the alerts that set none, or `null`. */
  readonly defaultQuietHours: DefaultQuietHours | null;
  /** Whether the template can change now. */
  readonly disabled: boolean;
  /** Saves a changed template. */
  readonly onTemplate: (template: MessageTemplate) => void;
}

/**
 * When the channels hear from the alert, in words.
 *
 * @param spec - The spec.
 * @returns Such as `On firing and on resolved · again every 30 minutes while firing`.
 */
export function notifyWords(spec: AlertSpec): string {
  const when = spec.notify.onResolved ? 'On firing and on resolved' : 'On firing';
  const repeat = spec.notify.repeatEvery;
  return repeat ? `${when} · again every ${durationWords(repeat)} while firing` : when;
}

/**
 * The previews of the draft's channels.
 *
 * @param props - The channels named, and the previews.
 * @param props.named - The draft's channels.
 * @param props.previews - The previews, once loaded.
 * @returns The previews, or what stands in for them.
 */
function Previews({
  named,
  previews,
}: {
  readonly named: readonly ChannelChoice[];
  readonly previews: PreviewOutcome | undefined;
}) {
  if (named.length === 0) return null;
  if (!previews) return <p className={styles.note}>Preparing the previews…</p>;
  if (!previews.ok) return <p className={styles.error}>{previews.message}</p>;
  return (
    <div className={styles.previews}>
      {named.map((channel) => (
        <ChannelPreview
          key={channel.id}
          name={channel.name}
          kind={channel.kind}
          body={previews.previews[channel.kind]}
        />
      ))}
    </div>
  );
}

/**
 * When the draft is quiet: which quiet hours it keeps, whether they hold now, and when it may
 * next notify.
 *
 * @param props - The spec and the default.
 * @param props.spec - The draft's spec.
 * @param props.defaults - The quiet hours of the alerts that set none, or `null`.
 * @returns The line.
 */
function QuietHoursLine({
  spec,
  defaults,
}: {
  readonly spec: AlertSpec;
  readonly defaults: DefaultQuietHours | null;
}) {
  const { schedule, status } = quietSummary(spec, defaults, Date.now());
  return (
    <p className={styles.note}>
      {schedule} {status}
    </p>
  );
}

/**
 * The Notifies card.
 *
 * @param props - The spec, the channels, the previews, the default quiet hours and the
 *   template's save.
 * @returns The card.
 */
export function Notifies(props: NotifiesProps) {
  const { spec, channels, previews, disabled, onTemplate } = props;
  const [editing, setEditing] = useState(false);
  const named = spec.channels.map(
    (id) =>
      channels.find((channel) => channel.id === id) ?? { id, name: `${id} (deleted)`, kind: '' },
  );
  return (
    <section className={styles.card} aria-label="Notifies">
      <div className={styles.cardHead}>
        <h3 className={styles.cardTitle}>Notifies</h3>
        {!editing && (
          <Button size="small" disabled={disabled} onClick={() => setEditing(true)}>
            Edit the message
          </Button>
        )}
      </div>
      {named.length === 0 ? (
        <p className={styles.note}>
          No channel yet. An admin adds them in Settings → Notifications.
        </p>
      ) : (
        <span className={styles.channel}>
          {named.map((channel) => `${channel.name} · ${channel.kind}`).join(', ')}
        </span>
      )}
      <p className={styles.note}>{notifyWords(spec)}</p>
      <QuietHoursLine spec={spec} defaults={props.defaultQuietHours} />
      {editing ? (
        <TemplateEditor
          template={spec.message}
          onCancel={() => setEditing(false)}
          onSave={(template) => {
            setEditing(false);
            onTemplate(template);
          }}
        />
      ) : (
        <Previews named={named} previews={previews} />
      )}
    </section>
  );
}
