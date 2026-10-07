import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { channelInputSchema, type Notification, notificationSchema } from '@quanthea/shared';
import { createAuditRepository } from '../db/audit-repository.ts';
import { createChannelRepository } from '../db/channel-repository.ts';
import { openDatabase } from '../db/database.ts';
import { runMigrations } from '../db/migrate.ts';
import { AppError } from '../lib/errors.ts';
import { openSecretBox, type SecretBox } from '../secrets/secret-box.ts';
import { temporaryDir, testSecretBox } from '../test/fixtures.ts';
import { maskTarget, openTarget } from './channel-store.ts';
import { createNotifications, type Notifications } from './notifications.ts';
import { resealChannels } from './reseal.ts';
import { signBody } from './signature.ts';

/** A request the fake `fetch` received. */
interface Received {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly redirect: string | undefined;
}

let dataDir: ReturnType<typeof temporaryDir>;
let database: ReturnType<typeof openDatabase>;
let secretBox: SecretBox;
let received: Received[];
let answers: (() => Response | Promise<Response>)[];
let waits: number[];
let resolved: Record<string, string[]>;
let alertsUsing: Record<string, number>;
let notifications: Notifications;

const slackUrl = 'https://hooks.slack.test/services/T000/B000/abcdefghSECRET';

beforeEach(async () => {
  dataDir = temporaryDir();
  database = openDatabase(dataDir.path);
  runMigrations(database);
  secretBox = await testSecretBox();
  received = [];
  answers = [];
  waits = [];
  resolved = {};
  alertsUsing = {};
  notifications = createNotifications({
    repository: createChannelRepository(database),
    secretBox,
    audit: createAuditRepository(database),
    alertsUsing: (id) => alertsUsing[id] ?? 0,
    publicUrl: 'https://quanthea.test',
    now: () => 1_760_000_000_000,
    delivery: {
      fetch: (url, init) => {
        const headers = Object.fromEntries(new Headers(init.headers).entries());
        received.push({ url, headers, body: String(init.body), redirect: init.redirect });
        const answer = answers.shift();
        return Promise.resolve(answer ? answer() : new Response('ok'));
      },
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
      resolve: (host) => Promise.resolve(resolved[host] ?? []),
    },
  });
});

afterEach(() => {
  database.close();
  dataDir.remove();
});

/**
 * Adds a channel.
 *
 * @param input - The channel, as an admin writes it.
 * @returns The channel's id.
 */
async function add(input: Record<string, unknown>): Promise<string> {
  return (await notifications.create(channelInputSchema.parse(input), 'admin-1')).id;
}

/**
 * A firing notification of the checkout alert.
 *
 * @param event - What it reports.
 * @returns The notification.
 */
function firing(event: Notification['event'] = 'alert.firing'): Notification {
  return notificationSchema.parse({
    event,
    alert: { id: 'a1', title: 'Errors', version: 1, severity: 'warning', url: 'https://q.test/a1' },
    series: { key: 'service=checkout', labels: { service: 'checkout' } },
    template: { title: '{alert} at {value}', body: 'Since {since}.' },
    values: { alert: 'Errors', value: '3%', since: '12:00' },
    at: '2026-10-04T12:00:00.000Z',
  });
}

/**
 * Whether a buffer holds a text.
 *
 * @param bytes - The bytes.
 * @param text - The text.
 * @returns `true` when the text appears in them.
 */
function holds(bytes: Uint8Array, text: string): boolean {
  return Buffer.from(bytes).includes(Buffer.from(text));
}

describe('channels at rest', () => {
  test('the URL and the secret are sealed, and only a masked target comes back', async () => {
    const secret = 'a-signing-secret-of-some-length';
    await add({ name: 'Slack', kind: 'slack', target: slackUrl, mentions: ['<!here>'] });
    await add({
      name: 'Ops',
      kind: 'webhook',
      target: 'https://ops.test/hook',
      signingSecret: secret,
    });
    const rows = database
      .query<{ [column: string]: unknown }, []>('SELECT * FROM notification_channels')
      .all();
    for (const row of rows)
      for (const value of Object.values(row)) {
        const bytes = value instanceof Uint8Array ? value : Buffer.from(String(value));
        expect(holds(bytes, 'SECRET')).toBe(false);
        expect(holds(bytes, secret)).toBe(false);
      }
    const listed = notifications.list();
    expect(listed.map((channel) => [channel.name, channel.target, channel.signed])).toEqual([
      ['Ops', 'ops.test/hook/…/hook', true],
      ['Slack', 'hooks.slack.test/services/…/CRET', false],
    ]);
    expect(JSON.stringify(listed)).not.toContain(secret);
    expect(notifications.picker()).toEqual(
      listed.map(({ id, name, kind }) => ({ id, name, kind })),
    );
  });

  test('a routing key shows its last four characters only', async () => {
    await add({ name: 'PD', kind: 'pagerduty', target: 'R0UT1NGKEY00000000000000000000ab' });
    expect(notifications.list()[0]?.target).toBe('••••00ab');
    expect(maskTarget('discord', 'https://discord.test/api/webhooks/1/xyz')).toBe(
      'discord.test/api/…/xyz',
    );
    expect(maskTarget('webhook', 'https://ops.test/')).toBe('ops.test');
  });

  test('a change keeps the sealed target and secret unless it gives new ones', async () => {
    const secret = 'a-signing-secret-of-some-length';
    const id = await add({
      name: 'Ops',
      kind: 'webhook',
      target: 'https://ops.test/hook',
      signingSecret: secret,
    });
    await notifications.update(id, { name: 'Ops hook' }, 'admin-1');
    await notifications.send([id], firing());
    expect(received[0]?.url).toBe('https://ops.test/hook');
    expect(received[0]?.headers['x-quanthea-signature']).toBeDefined();
    const changed = await notifications.update(id, { signingSecret: null }, 'admin-1');
    expect(changed).toMatchObject({ name: 'Ops hook', signed: false });
  });

  test('refuses a taken name, a metadata address, and a kind mismatch', async () => {
    await add({ name: 'Ops', kind: 'webhook', target: 'https://ops.test/hook' });
    await expect(
      add({ name: 'Ops', kind: 'webhook', target: 'https://other.test/' }),
    ).rejects.toThrow('already named');
    await expect(
      add({ name: 'Meta', kind: 'webhook', target: 'http://169.254.169.254/x' }),
    ).rejects.toThrow('metadata');
    resolved['sneaky.test'] = ['169.254.169.254'];
    await expect(
      add({ name: 'Sneaky', kind: 'webhook', target: 'https://sneaky.test/' }),
    ).rejects.toThrow('metadata');
    const slack = { name: 'S', kind: 'slack', target: slackUrl, signingSecret: 'x'.repeat(20) };
    expect(channelInputSchema.safeParse(slack).success).toBe(false);
    const insecure = { name: 'S', kind: 'slack', target: 'http://hooks.slack.test/x' };
    expect(channelInputSchema.safeParse(insecure).success).toBe(false);
    const mention = { name: 'S', kind: 'slack', target: slackUrl, mentions: ['@channel'] };
    expect(channelInputSchema.safeParse(mention).success).toBe(false);
  });

  test('a channel alerts send to cannot be deleted', async () => {
    const id = await add({ name: 'Ops', kind: 'webhook', target: 'https://ops.test/hook' });
    alertsUsing[id] = 2;
    expect(() => notifications.remove(id, 'admin-1')).toThrow(AppError);
    alertsUsing[id] = 0;
    notifications.remove(id, 'admin-1');
    expect(notifications.list()).toEqual([]);
  });

  test('a new key seals every channel again', async () => {
    const oldKey = crypto.getRandomValues(new Uint8Array(32));
    const newKey = crypto.getRandomValues(new Uint8Array(32));
    secretBox = await openSecretBox(oldKey);
    const repository = createChannelRepository(database);
    const audit = createAuditRepository(database);
    const delivery = { resolve: () => Promise.resolve([]) };
    const before = createNotifications({ repository, secretBox, audit, delivery });
    const input = channelInputSchema.parse({ name: 'Slack', kind: 'slack', target: slackUrl });
    const { id } = await before.create(input, 'admin-1');
    const rotated = await openSecretBox(newKey, oldKey);
    expect(await resealChannels(repository, rotated)).toBe(1);
    expect(await resealChannels(repository, rotated)).toBe(0);
    const row = repository.get(id);
    if (!row) throw new Error('missing');
    expect(rotated.isCurrent(row.secret)).toBe(true);
    expect(await openTarget(await openSecretBox(newKey), row)).toEqual({ target: slackUrl });
  });
});

describe('sending', () => {
  test('signs the webhook body with the timestamp, so the receiver can verify it', async () => {
    const secret = 'a-signing-secret-of-some-length';
    const id = await add({
      name: 'Ops',
      kind: 'webhook',
      target: 'https://ops.test/hook',
      signingSecret: secret,
    });
    const [result] = await notifications.send([id], firing());
    expect(result).toEqual({ channelId: id, ok: true, httpStatus: 200, attempts: 1, error: null });
    const request = received[0];
    if (!request) throw new Error('nothing sent');
    const timestamp = Number(request.headers['x-quanthea-timestamp']);
    expect(timestamp).toBe(1_760_000_000);
    const expected = await signBody(secret, timestamp, request.body);
    expect(request.headers['x-quanthea-signature']).toBe(`sha256=${expected}`);
    expect(request.headers['x-quanthea-event']).toBe('alert.firing');
    expect(request.redirect).toBe('manual');
    expect(JSON.parse(request.body).message.title).toBe('Errors at 3%');
  });

  test('an unsigned webhook carries no signature', async () => {
    const id = await add({ name: 'Ops', kind: 'webhook', target: 'https://ops.test/hook' });
    await notifications.send([id], firing());
    expect(received[0]?.headers['x-quanthea-signature']).toBeUndefined();
  });

  test('retries a 5xx and a 429, waiting as Retry-After asks, and logs one send', async () => {
    const id = await add({ name: 'Slack', kind: 'slack', target: slackUrl });
    answers = [
      () => new Response('busy', { status: 503 }),
      () => new Response('slow down', { status: 429, headers: { 'Retry-After': '2' } }),
      () => new Response('ok'),
    ];
    const [result] = await notifications.send([id], firing());
    expect(result).toMatchObject({ ok: true, attempts: 3, httpStatus: 200 });
    expect(waits).toEqual([1000, 2000]);
    const sends = notifications.sends(id);
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({
      event: 'alert.firing',
      alertId: 'a1',
      seriesKey: 'service=checkout',
      ok: true,
      attempts: 3,
    });
    expect(notifications.list()[0]?.lastSentAt).toBe(1_760_000_000_000);
  });

  test('gives up after two retries, and records the failure without the URL', async () => {
    const id = await add({ name: 'Slack', kind: 'slack', target: slackUrl });
    answers = [0, 1, 2].map(() => () => new Response(`no route to ${slackUrl}`, { status: 502 }));
    const [result] = await notifications.send([id], firing());
    expect(result).toMatchObject({ ok: false, attempts: 3, httpStatus: 502 });
    expect(result?.error).not.toContain('SECRET');
    expect(result?.error).toContain('hooks.slack.test/services/…/CRET');
    const [channel] = notifications.list();
    expect(channel?.lastError).toMatchObject({ status: 502 });
    expect(notifications.sends(id)[0]).toMatchObject({ ok: false, httpStatus: 502, attempts: 3 });
  });

  test('a network error is retried; a 4xx and a long Retry-After are not', async () => {
    const id = await add({ name: 'Slack', kind: 'slack', target: slackUrl });
    answers = [
      () => {
        throw Object.assign(new Error(`connect failed ${slackUrl}`), { code: 'ConnectionRefused' });
      },
      () => new Response('invalid_payload', { status: 400 }),
    ];
    const [refused] = await notifications.send([id], firing());
    expect(refused).toMatchObject({ ok: false, attempts: 2, httpStatus: 400 });
    expect(refused?.error).toBe('The service answered HTTP 400: invalid_payload');
    answers = [() => new Response('later', { status: 429, headers: { 'Retry-After': '3600' } })];
    const [limited] = await notifications.send([id], firing());
    expect(limited).toMatchObject({ ok: false, attempts: 1, httpStatus: 429 });
    const unreachable = notifications.sends(id).find((send) => send.httpStatus === 400);
    expect(unreachable?.error).not.toContain('SECRET');
  });

  test('a redirect is not followed', async () => {
    const id = await add({ name: 'Ops', kind: 'webhook', target: 'https://ops.test/hook' });
    answers = [
      () => new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/' } }),
    ];
    const [result] = await notifications.send([id], firing());
    expect(result).toMatchObject({ ok: false, attempts: 1, httpStatus: 302 });
    expect(received).toHaveLength(1);
  });

  test('a host that now resolves to a metadata address is not called', async () => {
    const id = await add({ name: 'Ops', kind: 'webhook', target: 'https://ops.test/hook' });
    resolved['ops.test'] = ['169.254.169.254'];
    const [result] = await notifications.send([id], firing());
    expect(result).toMatchObject({ ok: false, attempts: 0 });
    expect(received).toEqual([]);
  });

  test('each retry checks the destination again', async () => {
    const id = await add({ name: 'Ops', kind: 'webhook', target: 'https://ops.test/hook' });
    answers = [
      () => {
        resolved['ops.test'] = ['169.254.169.254'];
        return new Response('busy', { status: 503 });
      },
    ];
    const [result] = await notifications.send([id], firing());
    expect(result).toMatchObject({ ok: false, attempts: 1, httpStatus: 503 });
    expect(result?.error).toContain('metadata address');
    expect(received).toHaveLength(1);
  });

  test('an unknown channel fails on its own, and sending never throws', async () => {
    const id = await add({ name: 'Ops', kind: 'webhook', target: 'https://ops.test/hook' });
    const results = await notifications.send(['missing', id], firing());
    expect(results.map((result) => result.ok)).toEqual([false, true]);
  });

  test('the test sends a test message linking to the settings', async () => {
    const id = await add({
      name: 'PD',
      kind: 'pagerduty',
      target: 'R0UT1NGKEY0000000000000000000000',
    });
    const result = await notifications.test(id, 'admin-1');
    expect(result.ok).toBe(true);
    expect(received[0]?.url).toBe('https://events.pagerduty.com/v2/change/enqueue');
    expect(JSON.parse(received[0]?.body ?? '{}')).toMatchObject({
      routing_key: 'R0UT1NGKEY0000000000000000000000',
      payload: { summary: 'Test from quanthea: Checkout 5xx rate is 3.4%' },
      links: [{ href: 'https://quanthea.test/settings/notifications' }],
    });
    expect(notifications.sends(id)[0]?.event).toBe('alert.test');
  });
});

describe('the log', () => {
  test('keeps the newest sends of each channel, for a while', async () => {
    const id = await add({ name: 'Ops', kind: 'webhook', target: 'https://ops.test/hook' });
    const repository = createChannelRepository(database);
    const event = 'alert.firing' as const;
    const send = { channelId: id, event, alertId: 'a', reportId: null, seriesKey: '' };
    const outcome = { ok: true, httpStatus: 200, attempts: 1, error: null };
    for (let index = 0; index < 205; index += 1)
      repository.recordSend({
        ...send,
        ...outcome,
        id: `s${String(index).padStart(3, '0')}`,
        at: 1_760_000_000_000 - index,
      });
    repository.recordSend({ ...send, ...outcome, id: 'old', at: 1 });
    expect(notifications.purgeSends()).toBe(6);
    expect(notifications.sends(id)).toHaveLength(50);
  });
});

describe('previews', () => {
  test('show what each kind would send, with stand-in targets', () => {
    const previews = notifications.preview({
      event: 'alert.firing',
      template: { title: '{alert}', body: '{value}', fields: [] },
      values: { alert: '<!channel>', value: '1' },
      alert: { title: 'A', severity: 'info' },
      labels: { host: 'a' },
    });
    expect(previews.map((preview) => preview.kind)).toEqual([
      'webhook',
      'slack',
      'discord',
      'teams',
      'pagerduty',
    ]);
    expect(JSON.stringify(previews)).toContain('&lt;!channel&gt;');
    expect(JSON.stringify(previews.find((preview) => preview.kind === 'pagerduty'))).toContain(
      '<routing key>',
    );
  });
});
