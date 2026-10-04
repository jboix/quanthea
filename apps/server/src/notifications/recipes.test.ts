import { describe, expect, test } from 'bun:test';
import { type Notification, notificationSchema } from '@quanthea/shared';
import { discordRecipe, escapeDiscord } from './discord.ts';
import {
  dedupKeyOf,
  pagerDutyChangesUrl,
  pagerDutyEventsUrl,
  pagerDutyRecipe,
} from './pagerduty.ts';
import { fillText } from './recipe.ts';
import { channelRecipes } from './registry.ts';
import { escapeSlackText, escapeSlackValue, slackRecipe } from './slack.ts';
import { escapeTeams, teamsRecipe } from './teams.ts';
import { webhookRecipe } from './webhook.ts';

/** A zero-width space, as Slack values carry it around formatting characters. */
const z = '​';

/**
 * A notification of the checkout alert.
 *
 * @param event - What it reports.
 * @param values - Values that replace the defaults.
 * @returns The notification, validated.
 */
function notification(
  event: Notification['event'] = 'alert.firing',
  values: Notification['values'] = {},
): Notification {
  return notificationSchema.parse({
    event,
    alert: {
      id: 'alert-1',
      title: 'Checkout errors',
      version: 2,
      severity: 'critical',
      url: 'https://quanthea.test/alerts/alert-1',
    },
    series: { key: 'service=checkout', labels: { service: 'checkout' } },
    template: {
      title: '{alert} at {value}',
      body: 'Above {threshold} for {duration}.',
      fields: [{ label: 'Service', value: '{series}' }],
    },
    values: {
      alert: 'Checkout errors',
      value: '3.4%',
      threshold: '2%',
      duration: '5m',
      series: 'checkout',
      ...values,
    },
    at: '2026-10-04T12:17:00.000Z',
  });
}

/** A Slack channel with a mention. */
const slackChannel = {
  target: 'https://hooks.slack.test/services/T/B/x',
  mentions: ['<!subteam^S01>'],
};

/** A Discord channel mentioning a role and a user. */
const discordChannel = {
  target: 'https://discord.test/api/webhooks/1/x',
  mentions: ['<@&123456789>', '<@987654321>'],
};

/** Values written to break out of plain text. */
const hostile = {
  alert:
    '<!channel> @everyone <@U123> [x](http://evil) *bold* _it_ ~s~ `code` <b>html</b> & <http://evil|click>',
};

describe('filling a template', () => {
  test('replaces each placeholder with its escaped value, and a missing one with a dash', () => {
    const escapers = {
      text: (words: string) => words.toUpperCase(),
      value: (value: string) => `[${value}]`,
    };
    expect(fillText('{alert} is {value} since {since}', { alert: 'a', value: 'b' }, escapers)).toBe(
      '[a] IS [b] SINCE [-]',
    );
  });
});

describe('the webhook', () => {
  test('posts the notification and its filled message, values as the data gave them', () => {
    const request = webhookRecipe.build(notification('alert.firing', hostile), {
      target: 'https://hooks.test/x',
      mentions: [],
    });
    expect(request.url).toBe('https://hooks.test/x');
    expect(request.body).toMatchObject({
      event: 'alert.firing',
      alert: { id: 'alert-1', severity: 'critical' },
      series: { key: 'service=checkout' },
      message: {
        title: `${hostile.alert} at 3.4%`,
        body: 'Above 2% for 5m.',
        fields: [{ label: 'Service', value: 'checkout' }],
      },
      at: '2026-10-04T12:17:00.000Z',
    });
  });
});

describe('Slack', () => {
  test('a firing alert: mentions, a red attachment, header, body, fields, context and button', () => {
    const request = slackRecipe.build(notification(), slackChannel);
    expect(request.url).toBe(slackChannel.target);
    expect(request.body).toEqual({
      text: '<!subteam^S01> Checkout errors at 3.4%',
      attachments: [
        {
          color: '#c62828',
          blocks: [
            { type: 'header', text: { type: 'plain_text', text: 'Checkout errors at 3.4%' } },
            { type: 'section', text: { type: 'mrkdwn', text: 'Above 2% for 5m.' } },
            { type: 'section', fields: [{ type: 'mrkdwn', text: '*Service*\ncheckout' }] },
            {
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: `quanthea · Firing · critical · service=checkout · 2026-10-04T12:17:00.000Z`,
                },
              ],
            },
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  text: { type: 'plain_text', text: 'Open in quanthea' },
                  url: 'https://quanthea.test/alerts/alert-1',
                },
              ],
            },
          ],
        },
      ],
    });
  });

  test('resolved and test messages carry no mention, in green and grey', () => {
    const resolved = slackRecipe.build(notification('alert.resolved'), slackChannel).body as {
      text: string;
      attachments: { color: string }[];
    };
    expect(resolved.text).toBe('Checkout errors at 3.4%');
    expect(resolved.attachments[0]?.color).toBe('#2e7d32');
    const tested = slackRecipe.build(notification('alert.test'), slackChannel)
      .body as typeof resolved;
    expect(tested.text).toBe('Checkout errors at 3.4%');
    expect(tested.attachments[0]?.color).toBe('#6b7280');
  });

  test('values cannot write links, mentions or formatting', () => {
    const body = JSON.stringify(
      slackRecipe.build(notification('alert.resolved', hostile), slackChannel).body,
    );
    expect(body).not.toContain('<!channel>');
    expect(body).not.toContain('<@U123>');
    expect(body).not.toContain('<http://evil');
    expect(body).not.toContain('<b>');
    expect(escapeSlackValue(hostile.alert)).toBe(
      `&lt;!channel&gt; @everyone &lt;@U123&gt; [x](http://evil) ${z}*${z}bold${z}*${z} ${z}_${z}it${z}_${z} ${z}~${z}s${z}~${z} ${z}\`${z}code${z}\`${z} &lt;b&gt;html&lt;/b&gt; &amp; &lt;http://evil|click&gt;`,
    );
  });

  test('the template words are escaped as markup only', () => {
    expect(escapeSlackText('a < b & *c*')).toBe('a &lt; b &amp; *c*');
  });

  test('a relative link makes no button', () => {
    const relative = { ...notification(), alert: { ...notification().alert, url: '/alerts/a' } };
    expect(JSON.stringify(slackRecipe.build(relative, slackChannel).body)).not.toContain('button');
  });
});

describe('Discord', () => {
  test('a firing alert: the channel mentions, an embed, and only those mentions allowed', () => {
    const request = discordRecipe.build(notification(), discordChannel);
    expect(request.url).toBe(discordChannel.target);
    expect(request.body).toEqual({
      content: '<@&123456789> <@987654321>',
      embeds: [
        {
          title: 'Checkout errors at 3.4%',
          description: 'Above 2% for 5m.',
          url: 'https://quanthea.test/alerts/alert-1',
          color: 0xc62828,
          fields: [{ name: 'Service', value: 'checkout', inline: true }],
          footer: {
            text: 'quanthea · Firing · critical · service=checkout · 2026-10-04T12:17:00.000Z',
          },
          timestamp: '2026-10-04T12:17:00.000Z',
        },
      ],
      allowed_mentions: { parse: [], roles: ['123456789'], users: ['987654321'] },
    });
  });

  test('resolved and test messages mention no one and allow no mention', () => {
    for (const event of ['alert.resolved', 'alert.test'] as const) {
      const body = discordRecipe.build(notification(event), discordChannel).body as Record<
        string,
        unknown
      >;
      expect(body.content).toBeUndefined();
      expect(body.allowed_mentions).toEqual({ parse: [], roles: [], users: [] });
    }
  });

  test('values cannot format, link or mention', () => {
    expect(escapeDiscord(hostile.alert)).toBe(
      String.raw`\<!channel\> \@everyone \<\@U123\> \[x\]\(http\://evil\) \*bold\* \_it\_ \~s\~ \`code\` \<b\>html\</b\> & \<http\://evil\|click\>`,
    );
    const body = discordRecipe.build(notification('alert.firing', hostile), {
      ...discordChannel,
      mentions: [],
    }).body as { content?: string; allowed_mentions: unknown };
    expect(body.content).toBeUndefined();
    expect(body.allowed_mentions).toEqual({ parse: [], roles: [], users: [] });
  });
});

describe('Teams', () => {
  test('a firing alert: an Adaptive Card with a red header, facts and a button', () => {
    const request = teamsRecipe.build(notification(), {
      target: 'https://teams.test/flow',
      mentions: [],
    });
    expect(request.body).toEqual({
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          contentUrl: null,
          content: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.4',
            msteams: { width: 'Full' },
            body: [
              {
                type: 'Container',
                style: 'attention',
                bleed: true,
                items: [
                  {
                    type: 'TextBlock',
                    text: 'Checkout errors at 3.4%',
                    wrap: true,
                    weight: 'Bolder',
                    size: 'Large',
                  },
                ],
              },
              { type: 'TextBlock', text: 'Above 2% for 5m.', wrap: true },
              { type: 'FactSet', facts: [{ title: 'Service', value: 'checkout' }] },
              {
                type: 'TextBlock',
                text: 'quanthea · Firing · critical · service=checkout · 2026-10-04T12:17:00.000Z',
                wrap: true,
                isSubtle: true,
                size: 'Small',
              },
            ],
            actions: [
              {
                type: 'Action.OpenUrl',
                title: 'Open in quanthea',
                url: 'https://quanthea.test/alerts/alert-1',
              },
            ],
          },
        },
      ],
    });
  });

  test('resolved is green, a test is plain', () => {
    const style = (event: Notification['event']) =>
      JSON.stringify(
        teamsRecipe.build(notification(event), { target: 't', mentions: [] }).body,
      ).match(/"style":"(\w+)"/)?.[1];
    expect(style('alert.resolved')).toBe('good');
    expect(style('alert.test')).toBe('emphasis');
  });

  test('values cannot format or link', () => {
    expect(escapeTeams('[x](http://evil) *b* <at>me</at>')).toBe(
      String.raw`\[x\]\(http://evil\) \*b\* \<at\>me\</at\>`,
    );
  });
});

describe('PagerDuty', () => {
  const channel = { target: 'R0UT1NGKEY0000000000000000000000', mentions: [] };

  test('firing triggers an incident keyed by the alert and the series', () => {
    const request = pagerDutyRecipe.build(notification(), channel);
    expect(request.url).toBe(pagerDutyEventsUrl);
    expect(request.body).toEqual({
      routing_key: channel.target,
      event_action: 'trigger',
      dedup_key: 'alert-1/service=checkout',
      payload: {
        summary: 'Checkout errors at 3.4%',
        source: 'quanthea',
        severity: 'critical',
        timestamp: '2026-10-04T12:17:00.000Z',
        custom_details: {
          body: 'Above 2% for 5m.',
          Service: 'checkout',
          labels: { service: 'checkout' },
        },
      },
      client: 'quanthea',
      client_url: 'https://quanthea.test/alerts/alert-1',
      links: [{ href: 'https://quanthea.test/alerts/alert-1', text: 'Open in quanthea' }],
    });
  });

  test('resolving resolves the same incident', () => {
    const request = pagerDutyRecipe.build(notification('alert.resolved'), channel);
    expect(request).toEqual({
      url: pagerDutyEventsUrl,
      body: {
        routing_key: channel.target,
        event_action: 'resolve',
        dedup_key: 'alert-1/service=checkout',
      },
    });
  });

  test('a test is a change event, which pages no one', () => {
    const request = pagerDutyRecipe.build(notification('alert.test'), channel);
    expect(request.url).toBe(pagerDutyChangesUrl);
    expect(request.body).not.toHaveProperty('event_action');
    expect(request.body).toMatchObject({
      routing_key: channel.target,
      payload: { source: 'quanthea' },
    });
  });

  test('a long series key is hashed into a key PagerDuty takes', () => {
    const long = notification();
    const key = dedupKeyOf({ ...long, series: { key: 'x'.repeat(400), labels: {} } });
    expect(key.length).toBeLessThanOrEqual(255);
    expect(key).toStartWith('alert-1/sha256:');
    expect(dedupKeyOf({ ...long, series: { key: 'x'.repeat(400), labels: {} } })).toBe(key);
  });
});

describe('the registry', () => {
  test('has a recipe for every kind', () => {
    expect(Object.keys(channelRecipes).sort()).toEqual([
      'discord',
      'pagerduty',
      'slack',
      'teams',
      'webhook',
    ]);
    for (const [kind, recipe] of Object.entries(channelRecipes))
      expect(recipe.kind).toBe(kind as never);
  });
});
