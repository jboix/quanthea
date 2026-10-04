/**
 * What a notification channel would send, read back from the body its recipe builds, so the draft
 * pane can show it roughly as each service does. Everything stays plain text: the escapes each
 * recipe adds for its service are taken off for reading, never turned into markup.
 */

/** A message as the preview shows it. */
export interface PreviewView {
  /** The service's look: a coloured bar (Slack), an embed (Discord), a card (Teams), an incident line (PagerDuty), or JSON (webhook). */
  readonly look: 'slack' | 'discord' | 'teams' | 'pagerduty' | 'json';
  /** The colour of the bar or header, as CSS. */
  readonly color: string | null;
  /** The title. */
  readonly title: string;
  /** The body. */
  readonly body: string;
  /** The labelled fields. */
  readonly fields: readonly { readonly label: string; readonly value: string }[];
  /** The context line: state, severity, series and time. */
  readonly context: string | null;
  /** The JSON, for a webhook. */
  readonly json?: string;
}

/** A loose JSON object. */
type Loose = Record<string, unknown>;

/**
 * A value as a loose object.
 *
 * @param value - The value.
 * @returns The object, or an empty one.
 */
function objectOf(value: unknown): Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Loose)
    : {};
}

/**
 * A value as a list of loose objects.
 *
 * @param value - The value.
 * @returns The objects, or none.
 */
function listOf(value: unknown): Loose[] {
  return Array.isArray(value) ? value.map(objectOf) : [];
}

/**
 * A value as text.
 *
 * @param value - The value.
 * @returns The string, or empty.
 */
function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Slack's text for reading: its entities and the zero-width spaces that fence values taken off.
 *
 * @param text - The escaped text.
 * @returns The text.
 */
export function unescapeSlack(text: string): string {
  return text
    .replaceAll('​', '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

/**
 * Markdown escapes taken off, for Discord and Teams.
 *
 * @param text - The escaped text.
 * @returns The text.
 */
export function unescapeMarkdown(text: string): string {
  return text.replace(/\\([\\*_~`|>#\-[\]()<@:.!+{}])/g, '$1');
}

/**
 * Slack's attachment: header, body, `*label*\nvalue` fields and the context line.
 *
 * @param body - The request body.
 * @returns The view.
 */
function slackView(body: Loose): PreviewView {
  const attachment = listOf(body.attachments)[0] ?? {};
  const blocks = listOf(attachment.blocks);
  const block = (type: string) => blocks.filter((each) => each.type === type);
  const header = textOf(objectOf(block('header')[0]?.text).text);
  const sections = block('section');
  const fields = listOf(sections.find((each) => Array.isArray(each.fields))?.fields).map(
    (field) => {
      const [label = '', ...rest] = unescapeSlack(textOf(field.text)).split('\n');
      return { label: label.replace(/^\*(.*)\*$/, '$1'), value: rest.join('\n') };
    },
  );
  const context = textOf(listOf(block('context')[0]?.elements)[0]?.text);
  return {
    look: 'slack',
    color: textOf(attachment.color) || null,
    title: unescapeSlack(header),
    body: unescapeSlack(textOf(objectOf(sections[0]?.text).text)),
    fields,
    context: context ? unescapeSlack(context) : null,
  };
}

/**
 * Discord's embed.
 *
 * @param body - The request body.
 * @returns The view.
 */
function discordView(body: Loose): PreviewView {
  const embed = listOf(body.embeds)[0] ?? {};
  const color =
    typeof embed.color === 'number' ? `#${embed.color.toString(16).padStart(6, '0')}` : null;
  const fields = listOf(embed.fields).map((field) => ({
    label: unescapeMarkdown(textOf(field.name)),
    value: unescapeMarkdown(textOf(field.value)),
  }));
  const footer = textOf(objectOf(embed.footer).text);
  return {
    look: 'discord',
    color,
    title: unescapeMarkdown(textOf(embed.title)),
    body: unescapeMarkdown(textOf(embed.description)),
    fields,
    context: footer ? unescapeMarkdown(footer) : null,
  };
}

/** The colours of Teams' container styles. */
const teamsColors: Readonly<Record<string, string>> = {
  attention: '#c4314b',
  warning: '#c19c00',
  accent: '#2a55c9',
  good: '#2f7d4f',
  emphasis: '#8a8886',
};

/**
 * Teams' Adaptive Card: the coloured header, the body, the facts and the context line.
 *
 * @param body - The request body.
 * @returns The view.
 */
function teamsView(body: Loose): PreviewView {
  const card = objectOf(objectOf(listOf(body.attachments)[0]).content);
  const items = listOf(card.body);
  const header = items.find((each) => each.type === 'Container') ?? {};
  const texts = items.filter((each) => each.type === 'TextBlock');
  const facts = listOf(items.find((each) => each.type === 'FactSet')?.facts);
  return {
    look: 'teams',
    color: teamsColors[textOf(header.style)] ?? null,
    title: unescapeMarkdown(textOf(listOf(header.items)[0]?.text)),
    body: unescapeMarkdown(textOf(texts[0]?.text)),
    fields: facts.map((fact) => ({
      label: textOf(fact.title),
      value: unescapeMarkdown(textOf(fact.value)),
    })),
    context: texts[1] ? unescapeMarkdown(textOf(texts[1].text)) : null,
  };
}

/** The colours of PagerDuty's severities. */
const pagerDutyColors: Readonly<Record<string, string>> = {
  critical: '#c4314b',
  error: '#c4314b',
  warning: '#c19c00',
  info: '#2a55c9',
};

/**
 * PagerDuty's event: the incident's summary, severity and details.
 *
 * @param body - The request body.
 * @returns The view.
 */
function pagerDutyView(body: Loose): PreviewView {
  const payload = objectOf(body.payload);
  const { body: text, labels: _labels, ...details } = objectOf(payload.custom_details);
  const severity = textOf(payload.severity);
  const action = textOf(body.event_action) || 'change';
  return {
    look: 'pagerduty',
    color: pagerDutyColors[severity] ?? null,
    title: textOf(payload.summary),
    body: textOf(text),
    fields: Object.entries(details).map(([label, value]) => ({ label, value: textOf(value) })),
    context: [action, severity].filter(Boolean).join(' · '),
  };
}

/**
 * How a channel's message reads, from its recipe's body.
 *
 * @param kind - The channel's kind.
 * @param body - The body its recipe builds.
 * @returns The view.
 */
export function previewView(kind: string, body: unknown): PreviewView {
  const loose = objectOf(body);
  if (kind === 'slack') return slackView(loose);
  if (kind === 'discord') return discordView(loose);
  if (kind === 'teams') return teamsView(loose);
  if (kind === 'pagerduty') return pagerDutyView(loose);
  const message = objectOf(loose.message);
  return {
    look: 'json',
    color: null,
    title: textOf(message.title),
    body: textOf(message.body),
    fields: [],
    context: null,
    json: JSON.stringify(body, null, 2),
  };
}
