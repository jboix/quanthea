import { describe, expect, test } from 'bun:test';
import { type ReportNotification, reportNotificationSchema } from '@quanthea/shared';
import { escapeDiscord } from './discord.ts';
import { pagerDutyChangesUrl, pagerDutyEventsUrl } from './pagerduty.ts';
import { reportRecipes } from './registry.ts';
import { escapeSlackValue } from './slack.ts';
import { escapeTeams } from './teams.ts';

/** Text written to break out of plain text: mentions, links, markup and HTML. */
const hostile =
  '<!channel> @everyone <@U123> [x](http://evil) *bold* _it_ ~s~ `code` <b>html</b> & <http://evil|click>';

/**
 * A notification of the weekly sales report.
 *
 * @param event - What it reports.
 * @param overrides - Fields to replace.
 * @returns The notification, validated.
 */
function notification(
  event: ReportNotification['event'] = 'report.ready',
  overrides: Record<string, unknown> = {},
): ReportNotification {
  return reportNotificationSchema.parse({
    event,
    test: false,
    report: { id: 'report-1', title: 'Weekly sales', version: 2 },
    run: {
      id: 'run-1',
      period: 'week 40, 29 Sep – 5 Oct',
      from: '2025-09-28T22:00:00.000Z',
      to: '2025-10-05T21:59:59.999Z',
      comparison: 'week 39, 22 – 28 Sep',
    },
    title: 'Weekly sales · week 40, 29 Sep – 5 Oct',
    lines: [
      { label: 'Revenue', value: 'CHF 184,320', change: '▲ 6.2%' },
      { label: 'Failed orders', value: '1.8%', change: '▼ 0.4 pt' },
    ],
    link: { label: 'Open the report', url: 'https://quanthea.test/reports/report-1/runs/run-1' },
    seeAlso: [{ label: 'Sales overview', url: 'https://quanthea.test/d/sales?from=a&to=b' }],
    reason: event === 'report.failed' ? 'Panel "Revenue": the data source did not answer.' : null,
    at: '2025-10-06T06:00:05.000Z',
    ...overrides,
  });
}

/** A Slack channel with a mention. */
const slackChannel = { target: 'https://hooks.slack.test/services/T/B/x', mentions: ['<!here>'] };

/** A Discord channel mentioning a role. */
const discordChannel = {
  target: 'https://discord.test/api/webhooks/1/x',
  mentions: ['<@&123456>'],
};

/** A channel without mentions. */
const plainChannel = { target: 'https://hooks.test/x', mentions: [] };

/** A PagerDuty channel. */
const pagerDutyChannel = { target: 'R0UT1NGKEY0000000000000000000000', mentions: [] };

/**
 * A request body as JSON text, to search.
 *
 * @param body - The body.
 * @returns Its JSON.
 */
const text = (body: unknown) => JSON.stringify(body);

describe('a ready report', () => {
  test('in Slack lists the numbers and links, and mentions no one', () => {
    const { body } = reportRecipes.slack.build(notification(), slackChannel);
    expect(body).toMatchObject({
      text: 'Weekly sales · week 40, 29 Sep – 5 Oct',
      attachments: [{ color: '#2a55c9' }],
    });
    const json = text(body);
    expect(json).toContain('*Revenue*  CHF 184,320  ▲ 6.2%');
    expect(json).toContain('https://quanthea.test/reports/report-1/runs/run-1');
    expect(json).toContain('Sales overview');
    expect(json).not.toContain('<!here>');
  });

  test('in Discord pings no one, and in Teams lists the numbers as facts', () => {
    const discord = reportRecipes.discord.build(notification(), discordChannel).body;
    expect(discord).toMatchObject({ allowed_mentions: { parse: [], roles: [], users: [] } });
    expect(discord).not.toHaveProperty('content');
    expect(text(discord)).toContain('CHF 184,320  ▲ 6.2%');
    const teams = reportRecipes.teams.build(notification(), plainChannel).body;
    expect(text(teams)).toContain('{"title":"Revenue","value":"CHF 184,320  ▲ 6.2%"}');
    expect(text(teams)).toContain('"type":"Action.OpenUrl"');
  });

  test('pages no one on PagerDuty: it resolves the report failure incident', () => {
    const request = reportRecipes.pagerduty.build(notification(), pagerDutyChannel);
    expect(request).toEqual({
      url: pagerDutyEventsUrl,
      body: {
        routing_key: pagerDutyChannel.target,
        event_action: 'resolve',
        dedup_key: 'report-1/failed',
      },
    });
  });

  test('reaches a webhook as the notification itself', () => {
    const ready = notification();
    expect(reportRecipes.webhook.build(ready, plainChannel)).toEqual({
      url: plainChannel.target,
      body: { ...ready },
    });
  });
});

describe('a failed report', () => {
  test('triggers a warning incident on PagerDuty, closed by the next good run', () => {
    const { url, body } = reportRecipes.pagerduty.build(
      notification('report.failed'),
      pagerDutyChannel,
    );
    expect(url).toBe(pagerDutyEventsUrl);
    expect(body).toMatchObject({
      event_action: 'trigger',
      dedup_key: 'report-1/failed',
      payload: {
        severity: 'warning',
        summary: 'Weekly sales · week 40, 29 Sep – 5 Oct failed',
        custom_details: { period: 'week 40, 29 Sep – 5 Oct' },
      },
    });
  });

  test('mentions the channel in Slack and Discord, with the reason', () => {
    const slack = reportRecipes.slack.build(notification('report.failed'), slackChannel).body;
    expect(slack).toMatchObject({ text: '<!here> Weekly sales · week 40, 29 Sep – 5 Oct failed' });
    expect(text(slack)).toContain('the data source did not answer');
    const discord = reportRecipes.discord.build(notification('report.failed'), discordChannel);
    expect(discord.body).toMatchObject({
      content: '<@&123456>',
      allowed_mentions: { parse: [], roles: ['123456'], users: [] },
    });
  });

  test('is a change event on PagerDuty when it is a test, and mentions no one', () => {
    const tried = notification('report.failed', { test: true });
    expect(reportRecipes.pagerduty.build(tried, pagerDutyChannel).url).toBe(pagerDutyChangesUrl);
    const slack = reportRecipes.slack.build(tried, slackChannel).body;
    expect(slack).toMatchObject({
      text: 'Test from quanthea: Weekly sales · week 40, 29 Sep – 5 Oct failed',
    });
  });
});

describe('text from the spec and the data', () => {
  const tampered = notification('report.failed', {
    title: hostile,
    lines: [{ label: hostile, value: hostile, change: null }],
    reason: hostile,
  });

  test('is inert in Slack: no link, mention or formatting', () => {
    const json = text(reportRecipes.slack.build(tampered, plainChannel).body);
    expect(json).not.toContain('<!channel>');
    expect(json).not.toContain('<http://evil|click>');
    expect(json).toContain(JSON.stringify(escapeSlackValue(hostile)).slice(1, -1));
  });

  test('is inert in Discord and Teams: every markdown character escaped', () => {
    const discord = text(reportRecipes.discord.build(tampered, plainChannel).body);
    expect(discord).toContain(JSON.stringify(escapeDiscord(hostile)).slice(1, -1));
    expect(discord).not.toContain('[x](http://evil)');
    const teams = text(reportRecipes.teams.build(tampered, plainChannel).body);
    expect(teams).toContain(JSON.stringify(escapeTeams(hostile)).slice(1, -1));
    expect(teams).not.toContain('[x](http://evil)');
  });

  test('leaves out a link that is not absolute', () => {
    const relative = notification('report.ready', {
      link: { label: 'Open the report', url: '/reports/report-1/runs/run-1' },
      seeAlso: [],
    });
    expect(text(reportRecipes.slack.build(relative, plainChannel).body)).not.toContain('actions');
    expect(reportRecipes.teams.build(relative, plainChannel).body).toMatchObject({
      attachments: [{ content: { actions: [] } }],
    });
  });
});
