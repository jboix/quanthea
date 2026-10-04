import {
  type ChannelKind,
  type ChannelView,
  channelKindInfo,
  channelKinds,
} from '@quanthea/shared';
import { type FormEvent, useState } from 'react';
import { Button } from '../../ui/button.tsx';
import { Input } from '../../ui/input.tsx';
import { Select } from '../../ui/select.tsx';
import { Switch } from '../../ui/switch.tsx';
import { TextArea } from '../../ui/text-area.tsx';
import type { ChannelFields } from './data.ts';
import styles from './notifications.module.css';

/** The kind choices. */
const kindOptions = channelKinds.map((kind) => ({
  value: kind,
  label: channelKindInfo[kind].label,
}));

/** Where each kind's target comes from, for the hint under it. */
const targetHints: Readonly<Record<ChannelKind, string>> = {
  webhook: 'Any http or https URL. quanthea posts JSON to it.',
  slack: 'From an incoming webhook in your Slack app: https://hooks.slack.com/services/…',
  discord: 'From the channel settings, Integrations, Webhooks: https://discord.com/api/webhooks/…',
  teams: 'From a Teams workflow that posts to a channel when a webhook request is received.',
  pagerduty: 'The integration key of an Events API v2 integration on a PagerDuty service.',
};

/** Props of {@link ChannelForm}. */
interface ChannelFormProps {
  /** The channel being changed, or `undefined` for a new one. */
  readonly channel?: ChannelView | undefined;
  /** Submits the fields. */
  readonly onSubmit: (fields: ChannelFields) => void;
  /** Whether a submission is on its way. */
  readonly busy: boolean;
  /** The server's issues, by field. */
  readonly issues: Readonly<Record<string, string>>;
}

/**
 * The fields as the form starts: the channel's, or a new Slack channel's.
 *
 * @param channel - The channel being changed, if any.
 * @returns The fields.
 */
function initialFields(channel: ChannelView | undefined): ChannelFields {
  return {
    name: channel?.name ?? '',
    kind: channel?.kind ?? 'slack',
    target: '',
    signingSecret: '',
    unsign: false,
    mentions: channel?.mentions.join('\n') ?? '',
  };
}

/**
 * The target field: a URL or a routing key. On a change, empty keeps the stored one.
 *
 * @param props - The fields, the setter, the channel and the issue.
 * @param props.fields - The fields.
 * @param props.change - Changes one field.
 * @param props.channel - The channel being changed, if any.
 * @param props.error - The server's issue with the target.
 * @returns The field.
 */
function TargetField({
  fields,
  change,
  channel,
  error,
}: {
  readonly fields: ChannelFields;
  readonly change: (next: Partial<ChannelFields>) => void;
  readonly channel: ChannelView | undefined;
  readonly error: string | undefined;
}) {
  const routingKey = channelKindInfo[fields.kind].target === 'routing-key';
  const kept = channel ? `Stored: ${channel.target}. Leave empty to keep it.` : undefined;
  return (
    <Input
      label={routingKey ? 'Routing key' : 'Webhook URL'}
      mono
      required={!channel}
      autoComplete="off"
      value={fields.target}
      hint={kept ?? targetHints[fields.kind]}
      error={error}
      onChange={(event) => change({ target: event.target.value })}
    />
  );
}

/**
 * The generic webhook's signing secret, and on a change a switch to stop signing.
 *
 * @param props - The fields, the setter, the channel and the issue.
 * @param props.fields - The fields.
 * @param props.change - Changes one field.
 * @param props.channel - The channel being changed, if any.
 * @param props.error - The server's issue with the secret.
 * @returns The fields, or nothing for a kind that signs nothing.
 */
function SecretField({
  fields,
  change,
  channel,
  error,
}: {
  readonly fields: ChannelFields;
  readonly change: (next: Partial<ChannelFields>) => void;
  readonly channel: ChannelView | undefined;
  readonly error: string | undefined;
}) {
  if (!channelKindInfo[fields.kind].signs) return null;
  const hint = channel?.signed
    ? 'A secret is stored. Leave empty to keep it.'
    : 'Optional, at least 16 characters. Requests then carry X-Quanthea-Signature.';
  return (
    <>
      <Input
        label="Signing secret"
        type="password"
        mono
        autoComplete="new-password"
        value={fields.signingSecret}
        hint={hint}
        error={error}
        disabled={fields.unsign}
        onChange={(event) => change({ signingSecret: event.target.value })}
      />
      {channel?.signed && (
        <Switch
          label="Stop signing"
          checked={fields.unsign}
          onChange={(unsign) => change({ unsign, signingSecret: '' })}
        />
      )}
    </>
  );
}

/**
 * The mentions, for the kinds that take them.
 *
 * @param props - The fields, the setter and the issue.
 * @param props.fields - The fields.
 * @param props.change - Changes one field.
 * @param props.error - The server's issue with the mentions.
 * @returns The field, or nothing for a kind that takes no mentions.
 */
function MentionsField({
  fields,
  change,
  error,
}: {
  readonly fields: ChannelFields;
  readonly change: (next: Partial<ChannelFields>) => void;
  readonly error: string | undefined;
}) {
  const example = channelKindInfo[fields.kind].mentionExample;
  if (!example) return null;
  return (
    <TextArea
      label="Mentions"
      mono
      rows={2}
      value={fields.mentions}
      hint={`Added when an alert starts firing, never when it resolves. One per line, such as ${example}.`}
      error={error}
      onChange={(event) => change({ mentions: event.target.value })}
    />
  );
}

/**
 * The form of a channel: kind, name, target, then what the kind takes.
 *
 * @param props - The channel, the submit handler, whether one is on its way, and the issues.
 * @returns The form.
 */
export function ChannelForm({ channel, onSubmit, busy, issues }: ChannelFormProps) {
  const [fields, setFields] = useState(() => initialFields(channel));
  const change = (next: Partial<ChannelFields>) =>
    setFields((current) => ({ ...current, ...next }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(fields);
  };
  const shared = { fields, change, channel };
  return (
    <form className={styles.form} onSubmit={submit}>
      <Select
        label="Kind"
        options={kindOptions}
        value={fields.kind}
        disabled={channel !== undefined}
        onChange={(event) => change({ kind: event.target.value as ChannelKind, mentions: '' })}
      />
      <Input
        label="Name"
        required
        value={fields.name}
        error={issues.name}
        onChange={(event) => change({ name: event.target.value })}
      />
      <TargetField {...shared} error={issues.target} />
      <SecretField {...shared} error={issues.signingSecret} />
      <MentionsField fields={fields} change={change} error={issues.mentions} />
      <Button type="submit" variant="primary" disabled={busy}>
        {channel ? 'Save' : 'Add channel'}
      </Button>
    </form>
  );
}
