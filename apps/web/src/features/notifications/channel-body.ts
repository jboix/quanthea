/** The channel form's fields, and the request bodies they make. */
import { type ChannelAuth, type ChannelKind, channelKindInfo } from '@quanthea/shared';

/** What the form does about credentials: keep the stored ones, send none, or set new ones. */
export type CredentialsChoice = 'keep' | 'none' | ChannelAuth['type'];

/** The fields of the channel form, as typed. */
export interface ChannelFields {
  /** The channel's name. */
  readonly name: string;
  /** The channel kind; fixed once the channel exists. */
  readonly kind: ChannelKind;
  /** The URL or routing key; empty on an edit keeps the stored one. */
  readonly target: string;
  /** The signing secret; empty keeps the stored one. */
  readonly signingSecret: string;
  /** Whether to stop signing. */
  readonly unsign: boolean;
  /** What to do about credentials, for a kind that sends any. */
  readonly credentials: CredentialsChoice;
  /** The user name of basic authentication. */
  readonly username: string;
  /** The password of basic authentication. */
  readonly password: string;
  /** The bearer token. */
  readonly token: string;
  /** The mentions, one per line. */
  readonly mentions: string;
}

/**
 * The mentions typed, one per line or separated by spaces.
 *
 * @param text - The text.
 * @returns The mentions.
 */
function mentionsOf(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/**
 * The credentials the form sets, for a kind that sends any.
 *
 * @param fields - The form's fields.
 * @returns The credentials, `null` to send none, or `undefined` to leave them as stored.
 */
function authOf(fields: ChannelFields): ChannelAuth | null | undefined {
  if (!channelKindInfo[fields.kind].authenticates || fields.credentials === 'keep')
    return undefined;
  if (fields.credentials === 'none') return null;
  if (fields.credentials === 'bearer') return { type: 'bearer', token: fields.token };
  return { type: 'basic', username: fields.username, password: fields.password };
}

/**
 * The body of a new channel.
 *
 * @param fields - The form's fields.
 * @returns The body.
 */
export function createBody(fields: ChannelFields) {
  const { name, kind, target, signingSecret } = fields;
  const mentions = mentionsOf(fields.mentions);
  const auth = authOf(fields);
  const secrets = { ...(signingSecret ? { signingSecret } : {}), ...(auth ? { auth } : {}) };
  return { name, kind, target, mentions, ...secrets };
}

/**
 * The body of a change: the target, the secret and the credentials only when set, so empty fields
 * keep the stored ones.
 *
 * @param fields - The form's fields.
 * @returns The body.
 */
export function updateBody(fields: ChannelFields) {
  const secret = fields.unsign ? { signingSecret: null } : {};
  const auth = authOf(fields);
  return {
    name: fields.name,
    mentions: mentionsOf(fields.mentions),
    ...(fields.target ? { target: fields.target } : {}),
    ...(fields.signingSecret ? { signingSecret: fields.signingSecret } : secret),
    ...(auth === undefined ? {} : { auth }),
  };
}
