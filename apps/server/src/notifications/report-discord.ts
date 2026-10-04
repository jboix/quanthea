/**
 * Discord's report message: an embed with the title, the headline numbers as fields, the reason a
 * run failed, the links and a footer. Every text from the spec or the data is escaped; on a
 * failure the channel's own mentions are the content, and the only ones allowed to ping.
 */
import type { ReportNotification } from '@quanthea/shared';
import { escapeDiscord } from './discord.ts';
import { isAbsoluteLink, type RecipeChannel, truncate } from './recipe.ts';
import {
  failureSentence,
  lineValue,
  openableLinks,
  type ReportRecipe,
  reportColour,
  reportContext,
  reportMentions,
  reportTitle,
} from './report-recipe.ts';

/**
 * The description: the reason a run failed, then the links as masked links.
 *
 * @param notification - The notification.
 * @returns The text.
 */
function descriptionOf(notification: ReportNotification): string {
  const links = openableLinks(notification).map(
    (link) => `[${escapeDiscord(link.label)}](${link.url})`,
  );
  const failure = failureSentence(notification, escapeDiscord);
  return [...(failure === null ? [] : [failure]), ...links].join('\n') || '-';
}

/**
 * The embed.
 *
 * @param notification - The notification.
 * @returns The embed.
 */
function embedOf(notification: ReportNotification) {
  const { link, lines } = notification;
  return {
    title: truncate(reportTitle(notification, escapeDiscord), 256),
    description: truncate(descriptionOf(notification), 4096),
    ...(isAbsoluteLink(link.url) ? { url: link.url } : {}),
    color: Number.parseInt(reportColour(notification).slice(1), 16),
    fields: lines.map((line) => ({
      name: truncate(escapeDiscord(line.label), 256),
      value: truncate(lineValue(line, escapeDiscord), 1024),
      inline: true,
    })),
    footer: { text: truncate(reportContext(notification, escapeDiscord), 2048) },
    timestamp: notification.at,
  };
}

/**
 * Builds Discord's body.
 *
 * @param notification - The notification.
 * @param channel - The channel.
 * @returns The request.
 */
function build(notification: ReportNotification, channel: RecipeChannel) {
  const mentions = reportMentions(notification, channel);
  const idOf = (mention: string) => mention.replace(/\D/g, '');
  const roles = mentions.filter((mention) => mention.startsWith('<@&')).map(idOf);
  const users = mentions.filter((mention) => !mention.startsWith('<@&')).map(idOf);
  const body = {
    ...(mentions.length > 0 ? { content: mentions.join(' ') } : {}),
    embeds: [embedOf(notification)],
    allowed_mentions: { parse: [], roles, users },
  };
  return { url: channel.target, body };
}

/** Discord's report recipe. */
export const discordReportRecipe: ReportRecipe = { kind: 'discord', build };
