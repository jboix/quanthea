/**
 * Slack: an incoming webhook, posted a Block Kit message in a coloured attachment. Slack reads
 * `<…>` as links and mentions, so `&`, `<` and `>` are escaped everywhere; values also have their
 * formatting characters fenced, so data cannot make text bold, struck or code.
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

/** A zero-width space: it keeps a formatting character from pairing with another. */
const fence = '​';

/**
 * Escapes the three characters Slack reads as markup.
 *
 * @param text - The text.
 * @returns The text, with `&`, `<` and `>` as entities.
 */
export function escapeSlackText(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * Escapes a value: markup, then the formatting characters fenced on both sides.
 *
 * @param value - The value from the data.
 * @returns The inert value.
 */
export function escapeSlackValue(value: string): string {
  return escapeSlackText(value).replace(/[*_~`]/g, (character) => `${fence}${character}${fence}`);
}

/** Slack's escapers for mrkdwn. */
const mrkdwn: Escapers = { text: escapeSlackText, value: escapeSlackValue };

/** Slack's escapers for plain text, where formatting means nothing. */
const plain: Escapers = { text: escapeSlackText, value: escapeSlackText };

/**
 * The message's blocks: header, body, fields, context and the button.
 *
 * @param notification - The notification.
 * @returns The blocks.
 */
function blocksOf(notification: Notification): unknown[] {
  const { template, values, alert } = notification;
  const title = fillMessage(template, values, plain).title;
  const message = fillMessage(template, values, mrkdwn);
  const fields = message.fields.slice(0, 10).map((field) => ({
    type: 'mrkdwn',
    text: truncate(`*${field.label}*\n${field.value}`, 2000),
  }));
  const button = {
    type: 'button',
    text: { type: 'plain_text', text: 'Open in quanthea' },
    url: alert.url,
  };
  return [
    { type: 'header', text: { type: 'plain_text', text: truncate(title, 150) } },
    { type: 'section', text: { type: 'mrkdwn', text: truncate(message.body, 3000) } },
    ...(fields.length > 0 ? [{ type: 'section', fields }] : []),
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: contextLine(notification, escapeSlackValue) }],
    },
    ...(isAbsoluteLink(alert.url) ? [{ type: 'actions', elements: [button] }] : []),
  ];
}

/**
 * Builds Slack's body: the title and any mentions as the notification text, the blocks in an
 * attachment coloured by state.
 *
 * @param notification - The notification.
 * @param channel - The channel.
 * @returns The request.
 */
function build(notification: Notification, channel: RecipeChannel) {
  const { template, values } = notification;
  const title = fillMessage(template, values, plain).title;
  const text = [...mentionsFor(notification, channel), truncate(title, 150)].join(' ');
  const attachment = { color: stateColour(notification), blocks: blocksOf(notification) };
  return { url: channel.target, body: { text, attachments: [attachment] } };
}

/** The Slack recipe. */
export const slackRecipe: ChannelRecipe = { kind: 'slack', build };
