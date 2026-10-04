/**
 * Teams' report message: an Adaptive Card with a coloured header, the reason a run failed, the
 * headline numbers as facts, a context line and an action per link. Every text from the spec or
 * the data is escaped; Teams channels take no mentions.
 */
import type { ReportNotification } from '@quanthea/shared';
import { type RecipeChannel, truncate } from './recipe.ts';
import {
  failureSentence,
  lineValue,
  openableLinks,
  type ReportRecipe,
  reportContext,
  reportTitle,
} from './report-recipe.ts';
import { escapeTeams } from './teams.ts';

/**
 * The header's container style: accent when ready, warning when failed, emphasis for a test.
 *
 * @param notification - The notification.
 * @returns An Adaptive Card container style.
 */
function styleOf(notification: ReportNotification): string {
  if (notification.test) return 'emphasis';
  return notification.event === 'report.ready' ? 'accent' : 'warning';
}

/**
 * A text block.
 *
 * @param text - The text, escaped.
 * @param extra - More properties.
 * @returns The block.
 */
function textBlock(text: string, extra: object = {}) {
  return { type: 'TextBlock', text, wrap: true, ...extra };
}

/**
 * The card's body: the header, the reason a run failed, the numbers and the context line.
 *
 * @param notification - The notification.
 * @returns The elements.
 */
function bodyOf(notification: ReportNotification): unknown[] {
  const title = truncate(reportTitle(notification, escapeTeams), 300);
  const header = textBlock(title, { weight: 'Bolder', size: 'Large' });
  const facts = notification.lines.map((line) => ({
    title: escapeTeams(line.label),
    value: lineValue(line, escapeTeams),
  }));
  const failure = failureSentence(notification, escapeTeams);
  return [
    { type: 'Container', style: styleOf(notification), bleed: true, items: [header] },
    ...(failure === null ? [] : [textBlock(truncate(failure, 3000))]),
    ...(facts.length > 0 ? [{ type: 'FactSet', facts }] : []),
    textBlock(reportContext(notification, escapeTeams), { isSubtle: true, size: 'Small' }),
  ];
}

/**
 * Builds the Workflows body: a message with the card as its one attachment.
 *
 * @param notification - The notification.
 * @param channel - The channel.
 * @returns The request.
 */
function build(notification: ReportNotification, channel: RecipeChannel) {
  const actions = openableLinks(notification).map((link) => ({
    type: 'Action.OpenUrl',
    title: truncate(escapeTeams(link.label), 100),
    url: link.url,
  }));
  const content = {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    msteams: { width: 'Full' },
    body: bodyOf(notification),
    actions,
  };
  const attachment = { contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null };
  return {
    url: channel.target,
    body: { type: 'message', attachments: [{ ...attachment, content }] },
  };
}

/** Teams' report recipe. */
export const teamsReportRecipe: ReportRecipe = { kind: 'teams', build };
