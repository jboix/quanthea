/**
 * Microsoft Teams: a Workflows webhook, posted an Adaptive Card. Its text blocks read a subset of
 * markdown, so every markdown character is escaped with a backslash: neither the template nor the
 * data can format text or hide a link. Teams channels take no mentions.
 */
import type { Notification } from '@quanthea/shared';
import {
  type ChannelRecipe,
  contextLine,
  type Escapers,
  fillMessage,
  isAbsoluteLink,
  type RecipeChannel,
  truncate,
} from './recipe.ts';

/**
 * Escapes the markdown an Adaptive Card text block reads.
 *
 * @param text - The text.
 * @returns The text with each markdown character escaped.
 */
export function escapeTeams(text: string): string {
  return text.replace(/[\\*_~`[\]()#>\-+!<|]/g, (character) => `\\${character}`);
}

/** Teams' escapers: the template's words and the values alike stay plain text. */
const teams: Escapers = { text: escapeTeams, value: escapeTeams };

/**
 * The container style of a notification's header: by severity while firing, warning when it
 * cannot be checked, good once resolved or checked again.
 *
 * @param notification - The notification.
 * @returns An Adaptive Card container style.
 */
function styleOf(notification: Notification): string {
  const { event } = notification;
  if (event === 'alert.resolved' || event === 'alert.recovered') return 'good';
  if (event === 'alert.test') return 'emphasis';
  if (event === 'alert.error') return 'warning';
  const bySeverity = { critical: 'attention', warning: 'warning', info: 'accent' } as const;
  return bySeverity[notification.alert.severity];
}

/**
 * The card: a coloured header with the title, the body, the fields as facts, a context line and
 * a button.
 *
 * @param notification - The notification.
 * @returns The Adaptive Card.
 */
function cardOf(notification: Notification) {
  const { template, values, alert } = notification;
  const message = fillMessage(template, values, teams);
  const text = (value: string, extra: object = {}) => ({
    type: 'TextBlock',
    text: value,
    wrap: true,
    ...extra,
  });
  const header = text(truncate(message.title, 300), { weight: 'Bolder', size: 'Large' });
  const facts = message.fields.map((field) => ({ title: field.label, value: field.value }));
  const open = { type: 'Action.OpenUrl', title: 'Open in quanthea', url: alert.url };
  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    msteams: { width: 'Full' },
    body: [
      { type: 'Container', style: styleOf(notification), bleed: true, items: [header] },
      text(truncate(message.body, 3000)),
      ...(facts.length > 0 ? [{ type: 'FactSet', facts }] : []),
      text(contextLine(notification, escapeTeams), { isSubtle: true, size: 'Small' }),
    ],
    actions: isAbsoluteLink(alert.url) ? [open] : [],
  };
}

/**
 * Builds the Workflows body: a message with the card as its one attachment.
 *
 * @param notification - The notification.
 * @param channel - The channel.
 * @returns The request.
 */
function build(notification: Notification, channel: RecipeChannel) {
  const attachment = {
    contentType: 'application/vnd.microsoft.card.adaptive',
    contentUrl: null,
    content: cardOf(notification),
  };
  return { url: channel.target, body: { type: 'message', attachments: [attachment] } };
}

/** The Teams recipe. */
export const teamsRecipe: ChannelRecipe = { kind: 'teams', build };
