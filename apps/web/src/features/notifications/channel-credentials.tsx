import { type ChannelView, channelKindInfo } from '@quanthea/shared';
import { Input } from '../../ui/input.tsx';
import { Select } from '../../ui/select.tsx';
import type { ChannelFields, CredentialsChoice } from './channel-body.ts';

/** The choices of a new channel, or of one that stores no credentials. */
const choices: readonly { value: CredentialsChoice; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'basic', label: 'User name and password' },
  { value: 'bearer', label: 'Bearer token' },
];

/** The choice that leaves a channel's stored credentials as they are. */
const keepChoice = { value: 'keep', label: 'Keep the stored credentials' } as const;

/** Props of {@link CredentialsFields}. */
interface CredentialsFieldsProps {
  /** The fields. */
  readonly fields: ChannelFields;
  /** Changes some fields. */
  readonly change: (next: Partial<ChannelFields>) => void;
  /** The channel being changed, if any. */
  readonly channel: ChannelView | undefined;
  /** The server's issue with the credentials. */
  readonly error: string | undefined;
}

/** What every secret field shares: hidden, monospaced, never filled in by the browser. */
const secret = {
  type: 'password',
  mono: true,
  autoComplete: 'new-password',
  required: true,
} as const;

/**
 * The user name and password of basic authentication.
 *
 * @param props - The fields, the setter and the issue.
 * @returns The two fields.
 */
function BasicFields({ fields, change, error }: Omit<CredentialsFieldsProps, 'channel'>) {
  return (
    <>
      <Input
        label="User name"
        mono
        required
        autoComplete="off"
        value={fields.username}
        onChange={(event) => change({ username: event.target.value })}
      />
      <Input
        label="Password"
        {...secret}
        value={fields.password}
        error={error}
        onChange={(event) => change({ password: event.target.value })}
      />
    </>
  );
}

/**
 * The credentials a channel sends, for a kind that sends any: none, basic authentication or a
 * bearer token. A stored secret never comes back, so a change keeps it or replaces it.
 *
 * @param props - The fields, the setter, the channel and the issue.
 * @returns The fields, or nothing for a kind that sends no credentials.
 */
export function CredentialsFields({ fields, change, channel, error }: CredentialsFieldsProps) {
  if (!channelKindInfo[fields.kind].authenticates) return null;
  const { credentials } = fields;
  return (
    <>
      <Select
        label="Credentials"
        options={channel?.authenticated ? [keepChoice, ...choices] : choices}
        value={credentials}
        onChange={(event) => change({ credentials: event.target.value as CredentialsChoice })}
      />
      {credentials === 'basic' && <BasicFields fields={fields} change={change} error={error} />}
      {credentials === 'bearer' && (
        <Input
          label="Bearer token"
          {...secret}
          value={fields.token}
          error={error}
          onChange={(event) => change({ token: event.target.value })}
        />
      )}
    </>
  );
}
