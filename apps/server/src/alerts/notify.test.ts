import { describe, expect, test } from 'bun:test';
import { notificationSchema } from '@quanthea/shared';
import { buildNotification, decideNotification } from './notify.ts';
import { minute, spec } from './test/fixtures.ts';

const calm = {
  announced: false,
  notifiedAt: null,
  muted: false,
  quiet: false,
  since: 10 * minute,
  now: 10 * minute,
};
const notify = { onResolved: true, repeatEvery: '30m' };

describe('when a series notifies', () => {
  test('announces firing once', () => {
    expect(decideNotification(notify, { ...calm, state: 'firing' })).toEqual({
      event: 'alert.firing',
      announced: true,
      late: false,
      held: false,
    });
    const announced = {
      ...calm,
      announced: true,
      notifiedAt: 5 * minute,
      state: 'firing' as const,
    };
    expect(decideNotification(notify, announced).event).toBeNull();
  });

  test('repeats while firing, every repeatEvery', () => {
    const announced = { ...calm, announced: true, notifiedAt: 0, state: 'firing' as const };
    expect(decideNotification(notify, { ...announced, now: 29 * minute }).event).toBeNull();
    expect(decideNotification(notify, { ...announced, now: 30 * minute }).event).toBe(
      'alert.firing',
    );
    expect(
      decideNotification({ onResolved: true }, { ...announced, now: 90 * minute }).event,
    ).toBeNull();
  });

  test('announces resolving once it had announced firing, if asked', () => {
    const resolved = { ...calm, announced: true, state: 'ok' as const };
    expect(decideNotification(notify, resolved)).toEqual({
      event: 'alert.resolved',
      announced: false,
      late: false,
      held: false,
    });
    expect(decideNotification({ onResolved: false }, resolved)).toEqual({
      event: null,
      announced: false,
      late: false,
      held: false,
    });
    expect(decideNotification(notify, { ...resolved, state: null }).event).toBe('alert.resolved');
    expect(decideNotification(notify, { ...calm, state: 'ok' }).event).toBeNull();
  });

  test('sends nothing while muted, and announces a series still firing after', () => {
    const muted = { ...calm, muted: true };
    expect(decideNotification(notify, { ...muted, state: 'firing' })).toEqual({
      event: null,
      announced: false,
      late: false,
      held: false,
    });
    expect(decideNotification(notify, { ...muted, announced: true, state: 'ok' })).toEqual({
      event: null,
      announced: false,
      late: false,
      held: false,
    });
  });

  test('sends nothing during quiet hours, and announces a series still firing after', () => {
    const night = { ...calm, quiet: true, since: 2 * minute };
    expect(decideNotification(notify, { ...night, state: 'firing' })).toEqual({
      event: null,
      announced: false,
      late: false,
      held: true,
    });
    expect(decideNotification(notify, { ...night, quiet: false, state: 'firing' })).toEqual({
      event: 'alert.firing',
      announced: true,
      late: true,
      held: false,
    });
    expect(decideNotification(notify, { ...night, state: 'ok' }).event).toBeNull();
  });

  test('a repeat waits for quiet hours to end', () => {
    const firing = { ...calm, announced: true, notifiedAt: 0, state: 'firing' as const };
    const due = { ...firing, now: 40 * minute };
    expect(decideNotification(notify, { ...due, quiet: true })).toMatchObject({
      event: null,
      held: true,
    });
    expect(decideNotification(notify, { ...firing, quiet: true }).held).toBe(false);
    expect(decideNotification(notify, due)).toEqual({
      event: 'alert.firing',
      announced: true,
      late: false,
      held: false,
    });
  });

  test('a resolution it owes waits for quiet hours to end', () => {
    const resolved = { ...calm, announced: true, state: 'ok' as const };
    const waiting = { event: null, announced: true, late: false, held: true };
    expect(decideNotification(notify, { ...resolved, quiet: true })).toEqual(waiting);
    expect(decideNotification(notify, { ...resolved, quiet: true, state: null })).toEqual(waiting);
    expect(decideNotification(notify, resolved).event).toBe('alert.resolved');
    const unasked = decideNotification({ onResolved: false }, { ...resolved, quiet: true });
    expect(unasked.announced).toBe(false);
  });

  test('says nothing while pending, without data or failing', () => {
    for (const state of ['pending', 'no_data', 'error'] as const)
      expect(decideNotification(notify, { ...calm, announced: true, state })).toEqual({
        event: null,
        announced: true,
        late: false,
        held: false,
      });
  });
});

describe('a notification', () => {
  test('carries the template and the values from the series', () => {
    const at = Date.UTC(2026, 9, 3, 12, 4);
    const subject = {
      alertId: 'a1',
      version: 3,
      spec: spec({
        value: { format: { $fmt: 'percent', decimals: 1 } },
        condition: { kind: 'threshold', op: 'above', value: 0.05, for: '5m' },
        timezone: 'UTC',
      }),
      series: {
        key: '{service="checkout"}',
        labels: { service: 'checkout' },
        value: 0.084,
        since: at,
      },
      url: 'https://quanthea.test/alerts/a1',
    };
    const notification = buildNotification(subject, 'alert.firing', at + minute);
    expect(notificationSchema.parse(notification)).toEqual(notification);
    expect(notification.values).toEqual({
      alert: 'Checkout 5xx',
      series: 'service=checkout',
      value: '8.4%',
      threshold: 'above 5%',
      duration: '5m',
      since: '3 Oct, 12:04 UTC',
      severity: 'critical',
      link: 'https://quanthea.test/alerts/a1',
    });
    expect(notification.alert).toEqual({
      id: 'a1',
      title: 'Checkout 5xx',
      version: 3,
      severity: 'critical',
      url: 'https://quanthea.test/alerts/a1',
    });
  });

  test('says since when it fires when it announces late, unless the template does', () => {
    const series = { key: '{}', labels: {}, value: 9, since: 0 };
    const message = { title: '{alert} fires', body: '{value} is {threshold}.' };
    const about = (overrides: Record<string, unknown>) => ({
      alertId: 'a1',
      version: 1,
      spec: spec(overrides),
      series,
      url: '/alerts/a1',
    });
    const late = buildNotification(about({ message }), 'alert.firing', minute, true);
    expect(late.template.fields).toEqual([{ label: 'Firing since', value: '{since}' }]);
    expect(notificationSchema.parse(late)).toEqual(late);
    expect(buildNotification(about({ message }), 'alert.firing', 0).template.fields).toEqual([]);
    expect(buildNotification(about({}), 'alert.firing', minute, true).template.fields).toEqual([]);
  });

  test('names every series of a series without labels, and writes plain numbers', () => {
    const subject = {
      alertId: 'a1',
      version: 1,
      spec: spec(),
      series: { key: '{}', labels: {}, value: 12.34567, since: 0 },
      url: '/alerts/a1',
    };
    const { values } = buildNotification(subject, 'alert.resolved', 0);
    expect([values.series, values.value, values.threshold]).toEqual(['all', '12.35', 'above 5']);
  });
});
