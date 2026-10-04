/**
 * Discord: a webhook, posted an embed coloured by state. Every markdown character is escaped with
 * a backslash, so neither the template nor the data can format text, hide a link or write a
 * mention. `allowed_mentions` pings no one but the channel's own mentions, on `alert.firing` only.
 */
import type { Notification } from '@quanthea/shared';
import {
  type ChannelRecipe,
  contextLine,
  type Escapers,
  fillMessage,
  isAbsoluteLink,
  mentionsFor,
  type RecipeChannel,
  stateColour,
  truncate,
} from './recipe.ts';

/**
 * Escapes Discord markdown: formatting, quotes, headings, lists, masked links and mentions.
 *
 * @param text - The text.
 * @returns The text with each markdown character escaped.
 */
export function escapeDiscord(text: string): string {
  return text.replace(/[\\*_~`|>#\-[\]()<@:]/g, (character) => `\\${character}`);
}

/** Discord's escapers: the template's words and the values alike stay plain text. */
const discord: Escapers = { text: escapeDiscord, value: escapeDiscord };

/**
 * The ids of the channel's mentions, by type, for `allowed_mentions`.
 *
 * @param mentions - The mentions, as `<@&id>` for a role or `<@id>` for a user.
 * @returns The role ids and the user ids.
 */
function mentionIds(mentions: readonly string[]): { roles: string[]; users: string[] } {
  const idOf = (mention: string) => mention.replace(/\D/g, '');
  return {
    roles: mentions.filter((mention) => mention.startsWith('<@&')).map(idOf),
    users: mentions.filter((mention) => !mention.startsWith('<@&')).map(idOf),
  };
}

/**
 * The embed: title, description, link, colour, fields and a footer.
 *
 * @param notification - The notification.
 * @returns The embed.
 */
function embedOf(notification: Notification) {
  const { template, values, alert } = notification;
  const message = fillMessage(template, values, discord);
  return {
    title: truncate(message.title, 256),
    description: truncate(message.body, 4096),
    ...(isAbsoluteLink(alert.url) ? { url: alert.url } : {}),
    color: Number.parseInt(stateColour(notification).slice(1), 16),
    fields: message.fields.slice(0, 25).map((field) => ({
      name: truncate(field.label, 256),
      value: truncate(field.value, 1024) || '-',
      inline: true,
    })),
    footer: { text: truncate(contextLine(notification, escapeDiscord), 2048) },
    timestamp: notification.at,
  };
}

/**
 * Builds Discord's body: the mentions as content, the embed, and the mentions it may ping.
 *
 * @param notification - The notification.
 * @param channel - The channel.
 * @returns The request.
 */
function build(notification: Notification, channel: RecipeChannel) {
  const mentions = mentionsFor(notification, channel);
  const body = {
    ...(mentions.length > 0 ? { content: mentions.join(' ') } : {}),
    embeds: [embedOf(notification)],
    allowed_mentions: { parse: [], ...mentionIds(mentions) },
  };
  return { url: channel.target, body };
}

/** The Discord recipe. */
export const discordRecipe: ChannelRecipe = { kind: 'discord', build };
