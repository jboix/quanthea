import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  channelInputSchema,
  type Notification,
  notificationSchema,
  type ReportNotification,
  reportNotificationSchema,
} from '@quanthea/shared';
import { createAuditRepository } from '../db/audit-repository.ts';
import { createChannelRepository } from '../db/channel-repository.ts';
import { openDatabase } from '../db/database.ts';
import { runMigrations } from '../db/migrate.ts';
import { temporaryDir, testSecretBox } from '../test/fixtures.ts';
import { alertmanagerRecipe, alertsUrl } from './alertmanager.ts';
import { createNotifications, type Notifications } from './notifications.ts';
import { type FakeAlertmanager, startFakeAlertmanager } from './test/fake-alertmanager.ts';

const minute = 60_000;

/** Noon, when the series began to fire. */
const noon = Date.parse('2026-10-04T12:00:00.000Z');

let dataDir: ReturnType<typeof temporaryDir>;
let database: ReturnType<typeof openDatabase>;
let notifications: Notifications;
let alertmanager: FakeAlertmanager;
let now: number;

beforeEach(async () => {
  dataDir = temporaryDir();
  database = openDatabase(dataDir.path);
  runMigrations(database);
  now = noon;
  notifications = createNotifications({
    repository: createChannelRepository(database),
    secretBox: await testSecretBox(),
    audit: createAuditRepository(database),
    publicUrl: 'https://quanthea.test',
    now: () => now,
    delivery: { resolve: () => Promise.resolve([]), sleep: () => Promise.resolve() },
  });
});

afterEach(async () => {
  await alertmanager?.stop();
  database.close();
  dataDir.remove();
});

/**
 * Starts the fake and adds a channel that sends to it.
 *
 * @param options - How the fake is set up.
 * @param auth - The credentials the channel sends, if any.
 * @returns The channel's id.
 */
async function channelTo(
  options: Parameters<typeof startFakeAlertmanager>[0] = {},
  auth?: unknown,
): Promise<string> {
  alertmanager = startFakeAlertmanager(options);
  const input = { name: 'On-call', kind: 'alertmanager', target: alertmanager.url, auth };
  return (await notifications.create(channelInputSchema.parse(input), 'admin-1')).id;
}

/**
 * A notification of the checkout alert, sent now.
 *
 * @param event - What it reports.
 * @param overrides - Fields to replace.
 * @returns The notification, validated.
 */
function about(event: Notification['event'], overrides: Record<string, unknown> = {}) {
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
    },
    at: new Date(now).toISOString(),
    ...overrides,
  });
}

/**
 * Sends a notification to the fake at an instant.
 *
 * @param channelId - The channel.
 * @param at - When, in epoch milliseconds.
 * @param build - Builds the notification once the clock is set.
 * @returns The channel's result.
 */
async function sendAt(channelId: string, at: number, build: () => Notification) {
  now = at;
  alertmanager.setNow(at);
  const [result] = await notifications.send([channelId], build());
  return result;
}

/**
 * A firing that holds for some minutes unless it is said again.
 *
 * @param minutes - How long it holds, from now.
 * @returns The notification's `firing`.
 */
function holding(minutes: number) {
  return {
    firing: {
      since: new Date(noon).toISOString(),
      until: new Date(now + minutes * minute).toISOString(),
    },
  };
}

describe('the Alertmanager recipe', () => {
  const channel = { target: 'http://alertmanager:9093', mentions: [] };

  test('posts to the v2 alerts endpoint, under a route prefix when the base has one', () => {
    expect(alertsUrl('http://alertmanager:9093')).toBe('http://alertmanager:9093/api/v2/alerts');
    expect(alertsUrl('https://ops.test/alertmanager/')).toBe(
      'https://ops.test/alertmanager/api/v2/alerts',
    );
    expect(alertsUrl('https://ops.test/am/api/v2/alerts')).toBe(
      'https://ops.test/am/api/v2/alerts',
    );
  });

  test('a firing alert carries its labels, the message, the value and the link back', () => {
    const firing = { since: '2026-10-04T11:55:00.000Z' };
    const { url, body } = alertmanagerRecipe.build(about('alert.firing', { firing }), channel);
    expect(url).toBe('http://alertmanager:9093/api/v2/alerts');
    expect(body).toEqual([
      {
        labels: {
          alertname: 'Checkout errors',
          severity: 'critical',
          quanthea_alert: 'alert-1',
          service: 'checkout',
        },
        annotations: {
          summary: 'Checkout errors at 3.4%',
          description: 'Above 2% for 5m.\nService: checkout',
          value: '3.4%',
        },
        startsAt: '2026-10-04T11:55:00.000Z',
        generatorURL: 'https://quanthea.test/alerts/alert-1',
      },
    ]);
  });

  test('a link that is not absolute is left out', () => {
    const relative = about('alert.firing', {
      alert: { ...about('alert.firing').alert, url: '/alerts/a' },
    });
    const [alert] = alertmanagerRecipe.build(relative, channel).body as [Record<string, unknown>];
    expect(alert).not.toHaveProperty('generatorURL');
  });
});

describe('an alert, as an Alertmanager keeps it', () => {
  test('fires since the series began, and ends when it resolves', async () => {
    const id = await channelTo();
    const fired = await sendAt(id, noon + 5 * minute, () => about('alert.firing', holding(30)));
    expect(fired).toMatchObject({ ok: true, httpStatus: 200, attempts: 1 });
    expect(alertmanager.firingAt(noon + 10 * minute)).toHaveLength(1);
    expect(alertmanager.alerts()[0]).toMatchObject({ startsAt: noon });
    await sendAt(id, noon + 20 * minute, () => about('alert.resolved'));
    expect(alertmanager.alerts()).toHaveLength(1);
    expect(alertmanager.alerts()[0]).toMatchObject({ startsAt: noon, endsAt: noon + 20 * minute });
    expect(alertmanager.firingAt(noon + 21 * minute)).toEqual([]);
  });

  test('a firing holds until the instant it names, and longer each time it is said again', async () => {
    const id = await channelTo();
    await sendAt(id, noon, () => about('alert.firing', holding(4)));
    expect(alertmanager.firingAt(noon + 3 * minute)).toHaveLength(1);
    expect(alertmanager.firingAt(noon + 4 * minute)).toEqual([]);
    now = noon + minute;
    alertmanager.setNow(now);
    await notifications.keepAlive([id], about('alert.firing', holding(4)));
    expect(alertmanager.alerts()).toHaveLength(1);
    expect(alertmanager.alerts()[0]).toMatchObject({ startsAt: noon });
    expect(alertmanager.firingAt(noon + 4 * minute)).toHaveLength(1);
    expect(alertmanager.firingAt(noon + 5 * minute)).toEqual([]);
  });

  test('a keep-alive is no message: it logs no send, and reaches no other kind', async () => {
    const id = await channelTo();
    let heard = 0;
    const hook = Bun.serve({ port: 0, fetch: () => new Response(`${++heard}`) });
    const chat = { name: 'Chat', kind: 'webhook', target: `http://127.0.0.1:${hook.port}/hook` };
    const other = (await notifications.create(channelInputSchema.parse(chat), 'admin-1')).id;
    await notifications.keepAlive([id, other, 'gone'], about('alert.firing', holding(4)));
    await notifications.send([other], about('alert.firing', holding(4)));
    await hook.stop();
    expect(heard).toBe(1);
    expect(alertmanager.alerts()).toHaveLength(1);
    expect(notifications.sends(id)).toEqual([]);
    expect(notifications.sends(other)).toHaveLength(1);
  });

  test('a firing that names no end is ended by the resolve timeout', async () => {
    const id = await channelTo();
    const firing = { since: new Date(noon).toISOString() };
    await sendAt(id, noon, () => about('alert.firing', { firing }));
    expect(alertmanager.firingAt(noon + 4 * minute)).toHaveLength(1);
    expect(alertmanager.firingAt(noon + 5 * minute)).toEqual([]);
  });

  test('each series is an alert of its own', async () => {
    const id = await channelTo();
    const cart = { key: 'service=cart', labels: { service: 'cart' } };
    await sendAt(id, noon, () => about('alert.firing', holding(4)));
    await sendAt(id, noon, () => about('alert.firing', { ...holding(4), series: cart }));
    await sendAt(id, noon + minute, () => about('alert.resolved', { series: cart }));
    const firing = alertmanager.firingAt(noon + 2 * minute);
    expect(firing.map((alert) => alert.labels.service)).toEqual(['checkout']);
  });

  test('an alert that cannot be checked is an alert of its own, which its recovery ends', async () => {
    const id = await channelTo();
    const whole = { series: { key: '', labels: {} } };
    await sendAt(id, noon, () => about('alert.firing', holding(4)));
    await sendAt(id, noon + minute, () => about('alert.error', whole));
    expect(alertmanager.alerts().map((alert) => alert.labels.quanthea_check)).toEqual([
      undefined,
      'failed',
    ]);
    expect(alertmanager.firingAt(noon + 2 * minute)).toHaveLength(2);
    await sendAt(id, noon + 3 * minute, () => about('alert.recovered', whole));
    const firing = alertmanager.firingAt(noon + 4 * minute);
    expect(firing.map((alert) => alert.labels.quanthea_check)).toEqual([undefined]);
  });

  test('labels the data named badly are still taken', async () => {
    const id = await channelTo();
    const series = { key: 'x', labels: { 'k8s.pod': 'web-1', severity: 'page', empty: '' } };
    const result = await sendAt(id, noon, () => about('alert.firing', { series }));
    expect(result?.ok).toBe(true);
    expect(alertmanager.alerts()[0]?.labels).toMatchObject({
      severity: 'critical',
      series_severity: 'page',
      k8s_pod: 'web-1',
    });
  });

  test('the test of a channel fires a marked alert that ends by itself', async () => {
    const id = await channelTo({ prefix: '/alertmanager' });
    alertmanager.setNow(noon);
    expect(await notifications.test(id, 'admin-1')).toMatchObject({ ok: true, httpStatus: 200 });
    const [alert] = alertmanager.alerts();
    expect(alert?.labels).toMatchObject({ quanthea_test: 'true', quanthea_alert: 'test' });
    expect(alert?.generatorURL).toBe('https://quanthea.test/settings/notifications');
    expect(alert).toMatchObject({ startsAt: noon, endsAt: noon + 5 * minute });
  });
});

describe('a report, as an Alertmanager keeps it', () => {
  /**
   * A notification of the weekly sales report, sent now.
   *
   * @param event - What it reports.
   * @param isTest - Whether it is a test.
   * @returns The notification, validated.
   */
  function report(event: ReportNotification['event'], isTest = false): ReportNotification {
    return reportNotificationSchema.parse({
      event,
      test: isTest,
      report: { id: 'report-1', title: 'Weekly sales', version: 2 },
      run: {
        id: 'run-1',
        period: 'week 40',
        from: '2026-09-27T22:00:00.000Z',
        to: '2026-10-04T21:59:59.999Z',
        comparison: null,
      },
      title: 'Weekly sales · week 40',
      lines: [{ label: 'Revenue', value: 'CHF 184,320', change: '▲ 6.2%' }],
      link: { label: 'Open the report', url: 'https://quanthea.test/reports/report-1/runs/run-1' },
      seeAlso: [],
      reason: event === 'report.failed' ? 'The data source did not answer.' : null,
      at: new Date(now).toISOString(),
    });
  }

  test('a failed run fires a warning, and the next good run ends it', async () => {
    const id = await channelTo();
    alertmanager.setNow(noon);
    await notifications.sendReport([id], report('report.failed'));
    const [failed] = alertmanager.alerts();
    expect(failed?.labels).toEqual({
      alertname: 'Weekly sales',
      severity: 'warning',
      quanthea_report: 'report-1',
    });
    expect(failed?.annotations.description).toContain('The data source did not answer.');
    expect(alertmanager.firingAt(noon + minute)).toHaveLength(1);
    expect(alertmanager.firingAt(noon + 23 * 60 * minute)).toHaveLength(1);
    expect(alertmanager.firingAt(noon + 24 * 60 * minute)).toEqual([]);
    now = noon + 2 * minute;
    alertmanager.setNow(now);
    await notifications.sendReport([id], report('report.ready'));
    expect(alertmanager.alerts()).toHaveLength(1);
    expect(alertmanager.firingAt(noon + 3 * minute)).toEqual([]);
  });

  test('a ready run alone fires nothing', async () => {
    const id = await channelTo();
    alertmanager.setNow(noon);
    const [result] = await notifications.sendReport([id], report('report.ready'));
    expect(result?.ok).toBe(true);
    expect(alertmanager.firingAt(noon)).toEqual([]);
    expect(alertmanager.firingAt(noon + minute)).toEqual([]);
  });
});

describe('an Alertmanager channel', () => {
  test('sends basic credentials, sealed and never returned', async () => {
    const basic = `Basic ${Buffer.from('ops:s3cret-pass').toString('base64')}`;
    const id = await channelTo(
      { authorization: basic },
      { type: 'basic', username: 'ops', password: 's3cret-pass' },
    );
    expect((await sendAt(id, noon, () => about('alert.firing')))?.ok).toBe(true);
    const [listed] = notifications.list();
    expect(listed).toMatchObject({ authenticated: true, signed: false });
    expect(JSON.stringify(listed)).not.toContain('s3cret-pass');
    const rows = database.query('SELECT * FROM notification_channels').all();
    expect(Buffer.from(JSON.stringify(rows)).includes(Buffer.from('s3cret-pass'))).toBe(false);
  });

  test('sends a bearer token', async () => {
    const id = await channelTo(
      { authorization: 'Bearer tok-123' },
      { type: 'bearer', token: 'tok-123' },
    );
    expect((await sendAt(id, noon, () => about('alert.firing')))?.ok).toBe(true);
    expect(alertmanager.alerts()).toHaveLength(1);
  });

  test('a refusal is recorded with its status, and not retried', async () => {
    const id = await channelTo(
      { authorization: 'Bearer right' },
      { type: 'bearer', token: 'wrong-token' },
    );
    const result = await sendAt(id, noon, () => about('alert.firing'));
    expect(result).toMatchObject({ ok: false, httpStatus: 401, attempts: 1 });
    expect(alertmanager.alerts()).toEqual([]);
    expect(notifications.sends(id)[0]).toMatchObject({ ok: false, httpStatus: 401 });
    expect(result?.error).toStartWith('The service answered HTTP 401: Unauthorized: Bearer ••••');
    expect(JSON.stringify(notifications.sends(id))).not.toContain('wrong-token');
  });

  test('a change keeps the credentials, replaces them, or drops them', async () => {
    const id = await channelTo({ authorization: 'Bearer one' }, { type: 'bearer', token: 'one' });
    await notifications.update(id, { name: 'Pager' }, 'admin-1');
    expect((await sendAt(id, noon, () => about('alert.firing')))?.ok).toBe(true);
    await notifications.update(id, { auth: { type: 'bearer', token: 'two' } }, 'admin-1');
    expect((await sendAt(id, noon, () => about('alert.firing')))?.httpStatus).toBe(401);
    const dropped = await notifications.update(id, { auth: null }, 'admin-1');
    expect(dropped.authenticated).toBe(false);
    expect((await sendAt(id, noon, () => about('alert.firing')))?.httpStatus).toBe(401);
  });

  test('shows its base URL, which holds no secret', async () => {
    await channelTo({ prefix: '/alertmanager' });
    expect(notifications.list()[0]?.target).toBe(`${new URL(alertmanager.url).host}/alertmanager`);
  });

  test('follows the outbound rules of a webhook, and takes credentials only where they belong', async () => {
    const base = { name: 'On-call', kind: 'alertmanager' };
    const refused = (target: string) => channelInputSchema.safeParse({ ...base, target }).success;
    expect(refused('http://alertmanager:9093')).toBe(true);
    expect(refused('http://ops:pw@alertmanager:9093')).toBe(false);
    expect(refused('ftp://alertmanager:9093')).toBe(false);
    expect(refused('http://alertmanager:9093/?receiver=x')).toBe(false);
    const metadata = channelInputSchema.parse({ ...base, target: 'http://169.254.169.254' });
    await expect(notifications.create(metadata, 'admin-1')).rejects.toMatchObject({
      code: 'bad_request',
    });
    const auth = { type: 'bearer', token: 'x' };
    const slack = {
      name: 'Slack',
      kind: 'slack',
      target: 'https://hooks.slack.test/services/a',
      auth,
    };
    expect(channelInputSchema.safeParse(slack).success).toBe(false);
    const spaced = { ...base, target: 'http://am:9093', auth: { type: 'bearer', token: 'a b' } };
    expect(channelInputSchema.safeParse(spaced).success).toBe(false);
  });
});
