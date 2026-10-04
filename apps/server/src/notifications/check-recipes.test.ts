import { describe, expect, test } from 'bun:test';
import { type Notification, notificationSchema } from '@quanthea/shared';
import { discordRecipe } from './discord.ts';
import { pagerDutyEventsUrl, pagerDutyRecipe } from './pagerduty.ts';
import { slackRecipe } from './slack.ts';
import { teamsRecipe } from './teams.ts';
import { webhookRecipe } from './webhook.ts';

/** A reason written to break out of plain text. */
const hostileReason = '<!channel> @everyone [x](http://evil) *bold* `code` <b>html</b> & more';

/**
 * A notification that the checkout alert cannot be checked, or can be again, with the fixed
 * message the evaluator writes.
 *
 * @param event - `alert.error` or `alert.recovered`.
 * @param reason - Why the query failed.
 * @returns The notification, validated.
 */
function checkNotice(
  event: 'alert.error' | 'alert.recovered',
  reason = 'Prometheus did not answer within 30 s.',
): Notification {
  const error = event === 'alert.error';
  return notificationSchema.parse({
    event,
    alert: {
      id: 'alert-1',
      title: 'Checkout errors',
      version: 2,
      severity: 'critical',
      url: 'https://quanthea.test/alerts/alert-1',
    },
    series: { key: '', labels: {} },
    template: {
      title: error ? '{alert} cannot be checked' : '{alert} can be checked again',
      body: error ? '{alert} cannot be checked: {reason}' : '{alert} can be checked again.',
      fields: [],
    },
    values: { alert: 'Checkout errors', severity: 'critical', ...(error ? { reason } : {}) },
    at: '2026-10-04T12:17:00.000Z',
  });
}

/** A channel with a mention, for Slack. */
const slackChannel = { target: 'https://hooks.slack.test/services/T/B/x', mentions: ['<!here>'] };

/** A channel with a role mention, for Discord. */
const discordChannel = { target: 'https://discord.test/api/webhooks/1/x', mentions: ['<@&42>'] };

describe('an alert that cannot be checked, and can be again', () => {
  test('Slack: amber with the mentions, then green without', () => {
    const error = slackRecipe.build(checkNotice('alert.error'), slackChannel).body as {
      text: string;
      attachments: { color: string; blocks: unknown[] }[];
    };
    expect(error.text).toBe('<!here> Checkout errors cannot be checked');
    expect(error.attachments[0]?.color).toBe('#e8a317');
    expect(JSON.stringify(error.attachments[0]?.blocks)).toContain(
      'Checkout errors cannot be checked: Prometheus did not answer within 30 s.',
    );
    expect(JSON.stringify(error)).toContain('quanthea · Cannot be checked · critical');
    const recovered = slackRecipe.build(checkNotice('alert.recovered'), slackChannel).body as {
      text: string;
      attachments: { color: string }[];
    };
    expect(recovered.text).toBe('Checkout errors can be checked again');
    expect(recovered.attachments[0]?.color).toBe('#2e7d32');
  });

  test('Slack: the reason cannot link, mention or format', () => {
    const body = JSON.stringify(
      slackRecipe.build(checkNotice('alert.error', hostileReason), slackChannel).body,
    );
    expect(body).not.toContain('<!channel>');
    expect(body).not.toContain('<b>');
    expect(body).toContain('&lt;!channel&gt;');
  });

  test('Discord: amber with the role, then green with no mention', () => {
    const error = discordRecipe.build(checkNotice('alert.error'), discordChannel).body as {
      content?: string;
      embeds: { color: number; description: string }[];
      allowed_mentions: unknown;
    };
    expect(error.content).toBe('<@&42>');
    expect(error.embeds[0]?.color).toBe(0xe8a317);
    expect(error.allowed_mentions).toEqual({ parse: [], roles: ['42'], users: [] });
    const recovered = discordRecipe.build(checkNotice('alert.recovered'), discordChannel).body as {
      content?: string;
      embeds: { color: number }[];
    };
    expect(recovered.content).toBeUndefined();
    expect(recovered.embeds[0]?.color).toBe(0x2e7d32);
  });

  test('Discord: the reason is escaped', () => {
    const notice = checkNotice('alert.error', hostileReason);
    const body = discordRecipe.build(notice, discordChannel).body as {
      embeds: { description: string }[];
    };
    expect(body.embeds[0]?.description).toContain('\\@everyone \\[x\\]\\(http\\://evil\\)');
  });

  test('Teams: a warning header, then a good one, the reason escaped', () => {
    const style = (notice: Notification) =>
      JSON.stringify(teamsRecipe.build(notice, { target: 'https://teams.test/x', mentions: [] }));
    expect(style(checkNotice('alert.error'))).toContain('"style":"warning"');
    expect(style(checkNotice('alert.recovered'))).toContain('"style":"good"');
    expect(style(checkNotice('alert.error', hostileReason))).toContain('\\\\*bold\\\\*');
  });

  test('the webhook carries the event and the reason as given', () => {
    const request = webhookRecipe.build(checkNotice('alert.error', hostileReason), {
      target: 'https://hooks.test/x',
      mentions: [],
    });
    expect(request.body).toMatchObject({
      event: 'alert.error',
      values: { reason: hostileReason },
      message: { title: 'Checkout errors cannot be checked' },
    });
    const recovered = webhookRecipe.build(checkNotice('alert.recovered'), {
      target: 'https://hooks.test/x',
      mentions: [],
    });
    expect(recovered.body).toMatchObject({ event: 'alert.recovered' });
  });

  test('PagerDuty: triggers an incident of its own, which recovering resolves', () => {
    const channel = { target: 'a'.repeat(32), mentions: [] };
    const error = pagerDutyRecipe.build(checkNotice('alert.error'), channel);
    expect(error.url).toBe(pagerDutyEventsUrl);
    expect(error.body).toMatchObject({
      event_action: 'trigger',
      dedup_key: 'alert-1/error',
      payload: {
        summary: 'Checkout errors cannot be checked',
        severity: 'critical',
        custom_details: {
          body: 'Checkout errors cannot be checked: Prometheus did not answer within 30 s.',
        },
      },
    });
    const recovered = pagerDutyRecipe.build(checkNotice('alert.recovered'), channel);
    expect(recovered.body).toEqual({
      routing_key: 'a'.repeat(32),
      event_action: 'resolve',
      dedup_key: 'alert-1/error',
    });
  });
});
