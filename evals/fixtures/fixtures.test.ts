import { afterEach, describe, expect, test } from 'bun:test';
import { alertSpecSchema, reportSpecSchema } from '@quanthea/shared';
import { allCases } from '../cases/index.ts';
import { checkoutShareAlert, dailyOrdersReport, definitionsWorld } from './fixtures.ts';
import { channelAlias, recordings } from './saved-thread.ts';
import { closeWorlds, world } from './test-world.ts';

afterEach(closeWorlds);

describe('the recordings', () => {
  test('hold a spec the app’s own schema takes, and the channel as its alias', () => {
    const alert = alertSpecSchema.parse(recordings['alert-checkout-share'].data.spec);
    expect(alert.channels).toEqual([channelAlias]);
    expect(alert.condition).toMatchObject({
      kind: 'threshold',
      op: 'above',
      value: 0.02,
      for: '5m',
    });
    const report = reportSpecSchema.parse(recordings['report-daily-orders'].data.spec);
    expect(report.delivery.channels).toEqual([channelAlias]);
    expect(report.schedule).toMatchObject({ every: 'day', at: '07:00' });
  });

  test('ask what the cases they stand for ask, so a follow-up continues the same talk', () => {
    const turnOf = (id: string) => allCases.find((each) => each.id === id)?.input.turns[0];
    expect(recordings['alert-checkout-share'].data.ask).toBe(turnOf('al1') as string);
    expect(recordings['report-daily-orders'].data.ask).toBe(turnOf('r1') as string);
  });
});

describe('the fixtures, built by the app’s services with no model', () => {
  test('a thread that wrote the checkout alert: ready, with its talk and one version', async () => {
    const made = await world();
    const { threadId } = await checkoutShareAlert.prepare(made);
    const thread = made.services.threads.get(threadId as string);
    expect(thread.state).toBe('ready');
    expect((thread.messages as { role: string }[]).map((each) => each.role)).toEqual([
      'user',
      'assistant',
    ]);
    const alert = made.services.alerts.get(thread.alertId as string, 'editor');
    expect(alert.versions).toHaveLength(1);
    expect(alert.versions[0]?.spec.channels).toEqual([made.channelId]);
  });

  test('a thread that wrote the daily orders report: ready, with one version', async () => {
    const made = await world();
    const { threadId } = await dailyOrdersReport.prepare(made);
    const thread = made.services.threads.get(threadId as string);
    expect(thread.state).toBe('ready');
    const report = made.services.reports.get(thread.reportId as string, 'editor');
    expect(report.versions).toHaveLength(1);
    expect(report.versions[0]?.spec.delivery.channels).toEqual([made.channelId]);
  });

  test('two worlds share nothing: what one fixture made, the next world does not hold', async () => {
    const first = await world();
    await checkoutShareAlert.prepare(first);
    const second = await world();
    expect(first.services.threads.list()).toHaveLength(1);
    expect(second.services.threads.list()).toHaveLength(0);
  });
});

test('the shop definitions are saved as the file would declare them, each a valid request', async () => {
  const made = await world();
  await definitionsWorld.prepare(made);
  const saved = made.services.definitions.list();
  expect(saved.map((each) => [each.definition.id, each.origin])).toEqual([
    ['big-orders', 'file'],
    ['failure-rate', 'file'],
  ]);
});
