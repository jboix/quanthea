/**
 * Slack's report message: the title (and, on a failure, the mentions) as the notification text,
 * and a coloured attachment with the headline numbers, the context line and a button per link.
 * Every title, label, number and reason is escaped as a value.
 */
import type { ReportNotification } from '@quanthea/shared';
import { type RecipeChannel, truncate } from './recipe.ts';
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
import { escapeSlackText, escapeSlackValue } from './slack.ts';

/**
 * The body of the message: the reason a run failed, else the headline numbers, one a line.
 *
 * @param notification - The notification.
 * @returns The mrkdwn text.
 */
function bodyOf(notification: ReportNotification): string {
  const failure = failureSentence(notification, escapeSlackValue);
  if (failure !== null) return failure;
  const lines = notification.lines.map(
    (line) => `*${escapeSlackValue(line.label)}*  ${lineValue(line, escapeSlackValue)}`,
  );
  return lines.length > 0 ? lines.join('\n') : 'The report is ready.';
}

/**
 * The blocks: header, body, context and a button per link.
 *
 * @param notification - The notification.
 * @returns The blocks.
 */
function blocksOf(notification: ReportNotification): unknown[] {
  const buttons = openableLinks(notification).map((link) => ({
    type: 'button',
    text: { type: 'plain_text', text: truncate(escapeSlackText(link.label), 75) },
    url: link.url,
  }));
  const header = truncate(reportTitle(notification, escapeSlackText), 150);
  return [
    { type: 'header', text: { type: 'plain_text', text: header } },
    { type: 'section', text: { type: 'mrkdwn', text: truncate(bodyOf(notification), 3000) } },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: reportContext(notification, escapeSlackValue) }],
    },
    ...(buttons.length > 0 ? [{ type: 'actions', elements: buttons }] : []),
  ];
}

/**
 * Builds Slack's body.
 *
 * @param notification - The notification.
 * @param channel - The channel.
 * @returns The request.
 */
function build(notification: ReportNotification, channel: RecipeChannel) {
  const title = truncate(reportTitle(notification, escapeSlackText), 150);
  const text = [...reportMentions(notification, channel), title].join(' ');
  const attachment = { color: reportColour(notification), blocks: blocksOf(notification) };
  return { url: channel.target, body: { text, attachments: [attachment] } };
}

/** Slack's report recipe. */
export const slackReportRecipe: ReportRecipe = { kind: 'slack', build };
