/**
 * The generic webhook and reports: the notification as JSON. The receiver renders it as it likes,
 * so nothing is escaped: titles and numbers stay as the run gave them. The sending service signs
 * the body when the channel has a secret.
 */
import type { ReportNotification } from '@quanthea/shared';
import type { RecipeChannel } from './recipe.ts';
import type { ReportRecipe } from './report-recipe.ts';

/**
 * Builds the body: the notification as it is.
 *
 * @param notification - The notification.
 * @param channel - The channel.
 * @returns The request.
 */
function build(notification: ReportNotification, channel: RecipeChannel) {
  return { url: channel.target, body: { ...notification } };
}

/** The webhook's report recipe. */
export const webhookReportRecipe: ReportRecipe = { kind: 'webhook', build };
