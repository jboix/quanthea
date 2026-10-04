import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { channelInputSchema, reportNotificationSchema } from '@quanthea/shared';
import { createAuditRepository } from '../db/audit-repository.ts';
import { createChannelRepository } from '../db/channel-repository.ts';
import { openDatabase } from '../db/database.ts';
import { runMigrations } from '../db/migrate.ts';
import { temporaryDir, testSecretBox } from '../test/fixtures.ts';
import { createNotifications, type Notifications } from './notifications.ts';

/** What the fake `fetch` received: the URL, the event header and the body. */
let received: { url: string; event: string | null; body: string }[];
let dataDir: ReturnType<typeof temporaryDir>;
let database: ReturnType<typeof openDatabase>;
let reportsUsing: Record<string, number>;
let notifications: Notifications;

beforeEach(async () => {
  dataDir = temporaryDir();
  database = openDatabase(dataDir.path);
  runMigrations(database);
  received = [];
  reportsUsing = {};
  notifications = createNotifications({
    repository: createChannelRepository(database),
    secretBox: await testSecretBox(),
    audit: createAuditRepository(database),
    reportsUsing: (id) => reportsUsing[id] ?? 0,
    now: () => 1_760_000_000_000,
    delivery: {
      fetch: (url, init) => {
        const event = new Headers(init.headers).get('x-quanthea-event');
        received.push({ url, event, body: String(init.body) });
        return Promise.resolve(new Response('ok'));
      },
      sleep: () => Promise.resolve(),
      resolve: () => Promise.resolve([]),
    },
  });
});

afterEach(() => {
  database.close();
  dataDir.remove();
});

/** A ready run of the weekly sales report. */
const ready = reportNotificationSchema.parse({
  event: 'report.ready',
  test: false,
  report: { id: 'report-1', title: 'Weekly sales', version: 1 },
  run: {
    id: 'run-1',
    period: 'week 40, 29 Sep – 5 Oct',
    from: '2025-09-28T22:00:00.000Z',
    to: '2025-10-05T21:59:59.999Z',
    comparison: null,
  },
  title: 'Weekly sales · week 40, 29 Sep – 5 Oct',
  lines: [{ label: 'Orders', value: '2,914', change: null }],
  link: { label: 'Open the report', url: '/reports/report-1/runs/run-1' },
  seeAlso: [],
  reason: null,
  at: '2025-10-06T06:00:05.000Z',
});

/**
 * Adds a generic webhook channel.
 *
 * @returns Its id.
 */
async function addWebhook(): Promise<string> {
  const input = { name: 'Ops', kind: 'webhook', target: 'https://ops.test/hook' };
  return (await notifications.create(channelInputSchema.parse(input), 'admin-1')).id;
}

describe('sending a report', () => {
  test('posts the event and logs the send with its report and run', async () => {
    const id = await addWebhook();
    const [result] = await notifications.sendReport([id], ready);
    expect(result).toMatchObject({ channelId: id, ok: true });
    expect(received).toHaveLength(1);
    expect(received[0]?.event).toBe('report.ready');
    expect(JSON.parse(received[0]?.body ?? '{}')).toMatchObject({ title: ready.title });
    expect(notifications.sends(id)).toMatchObject([
      { event: 'report.ready', alertId: '', reportId: 'report-1', seriesKey: 'run-1', ok: true },
    ]);
  });

  test('a channel reports send to cannot be deleted', async () => {
    const id = await addWebhook();
    reportsUsing[id] = 2;
    expect(() => notifications.remove(id, 'admin-1')).toThrow('2 reports send to this channel.');
    reportsUsing[id] = 0;
    notifications.remove(id, 'admin-1');
    expect(notifications.list()).toEqual([]);
  });
});
