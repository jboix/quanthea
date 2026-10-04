/**
 * The generic webhook: the notification as JSON, with the message filled. The receiver renders it
 * as it likes, so nothing is escaped: values stay as the data gave them. The sending service signs
 * the body when the channel has a secret.
 */
import type { Notification } from '@quanthea/shared';
import { type ChannelRecipe, type Escapers, fillMessage, type RecipeChannel } from './recipe.ts';

/** JSON escapes itself. */
const asIs: Escapers = { text: (words) => words, value: (value) => value };

/**
 * Builds the body: the notification, and its message filled.
 *
 * @param notification - The notification.
 * @param channel - The channel.
 * @returns The request.
 */
function build(notification: Notification, channel: RecipeChannel) {
  const { event, alert, series, values, at } = notification;
  const message = fillMessage(notification.template, values, asIs);
  return { url: channel.target, body: { event, alert, series, values, message, at } };
}

/** The webhook recipe. */
export const webhookRecipe: ChannelRecipe = { kind: 'webhook', build };
