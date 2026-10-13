import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { alertSpecSchema, reportSpecSchema } from '@quanthea/shared';
import { allCases } from '../cases/index.ts';
import { type EvalWorld, openWorld } from '../world/setup.ts';
import {
  alertFromPanel,
  aroundTheIncident,
  checkoutShareAlert,
  dailyOrdersReport,
  incidentAnswered,
} from './fixtures.ts';
import { channelAlias, recordings } from './saved-thread.ts';

const opened: { world: EvalWorld; dir: string }[] = [];
afterEach(async () => {
  for (const { world, dir } of opened.splice(0)) {
    await world.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * A world of its own, with no key: nothing in these tests calls a model.
 *
 * @returns The world.
 */
async function world(): Promise<EvalWorld> {
  const dir = mkdtempSync(join(tmpdir(), 'quanthea-fixtures-test-'));
  const cache = { dir, read: true, minIntervalMs: 0 };
  const made = await openWorld({ provider: 'anthropic', model: 'a-model' }, undefined, cache);
  opened.push({ world: made, dir });
  return made;
}

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

  test('the incident question, asked and answered, for a follow-up to carry as history', async () => {
    const made = await world();
    const given = await incidentAnswered.prepare(made);
    const { questions } = made.services;
    const time = { from: 'now-28h', to: 'now-16h' };
    const followUp = { dashboardId: given.dashboardId as string, version: 1, time };
    const shown = { timeZone: 'Europe/Zurich', variables: {}, hiddenMarkers: [] };
    const asked = {
      ...followUp,
      ...shown,
      question: 'How long?',
      parentId: given.parentQuestionId,
    };
    const prepared = questions.prepare(asked, 'evals');
    expect(prepared.history).toHaveLength(1);
    expect(prepared.history[0]?.question).toBe(aroundTheIncident);
    expect(prepared.history[0]?.answer).toContain('Deploy #481 of checkout-svc');
  });

  test('an alert thread started from a panel of the pinned dashboard, with nothing said', async () => {
    const made = await world();
    const given = await alertFromPanel('error-rate-by-service').prepare(made);
    const row = made.services.threads.row(given.threadId as string);
    expect(row.seed).toMatchObject({
      dashboardId: given.dashboardId,
      panelId: 'error-rate-by-service',
    });
    expect(made.services.threads.get(given.threadId as string).messages).toEqual([]);
  });

  test('two worlds share nothing: what one fixture made, the next world does not hold', async () => {
    const first = await world();
    await checkoutShareAlert.prepare(first);
    const second = await world();
    expect(first.services.threads.list()).toHaveLength(1);
    expect(second.services.threads.list()).toHaveLength(0);
  });
});
