import { expect, test } from 'bun:test';
import type { AlertTimelineEntry } from '@quanthea/shared';
import { detailedAlert } from './test-alerts.ts';
import { timeline } from './timeline.ts';

const event = {
  type: 'event',
  version: 3,
  seriesKey: '{service="checkout-svc"}',
  labels: { service: 'checkout-svc' },
  message: null,
  notified: false,
  quiet: false,
} as const;

test('lists the changes of state and what people did, the latest first', () => {
  const alert = detailedAlert({
    channels: [{ id: 'c1', name: '#oncall', kind: 'slack' }],
    versions: [
      {
        version: 3,
        spec: {} as never,
        note: 'wait raised to 5 min',
        createdBy: 'Ana',
        createdAt: 1,
        activatedAt: 2,
      },
    ],
  });
  const activity = { type: 'activity', by: 'Ana', until: null } as const;
  const entries: AlertTimelineEntry[] = [
    { ...activity, id: 'm', action: 'mute', at: 60, version: null },
    { ...event, id: 'e4', from: 'pending', to: 'firing', at: 50, value: 0.034, notified: true },
    { ...event, id: 'e3', from: 'ok', to: 'pending', at: 40, value: 0.031 },
    { ...activity, id: 'a', action: 'activate', at: 20, version: 3 },
    { ...event, id: 'e2', from: 'firing', to: 'ok', at: 10, value: 0.01, notified: true },
    {
      ...event,
      id: 'e1',
      labels: {},
      from: 'ok',
      to: 'error',
      at: 5,
      value: null,
      message: 'timeout',
    },
  ];
  const lines = timeline(entries, alert, 100);
  expect(lines.map((entry) => entry.key)).toEqual(['m', 'e4', 'e3', 'a', 'e2', 'e1']);
  expect(lines.map((entry) => [entry.at, entry.text, entry.tone])).toEqual([
    [60, 'Muted by Ana until unmuted', 'neutral'],
    [50, 'checkout-svc firing (3.4%) · notified #oncall', 'danger'],
    [40, 'checkout-svc pending (3.1%)', 'pending'],
    [20, 'v3 activated by Ana: wait raised to 5 min', 'neutral'],
    [10, 'checkout-svc resolved (1%) · notified #oncall', 'ok'],
    [5, 'all query failing: timeout', 'danger'],
  ]);
});

test('lists the times it could not be checked and could be again', () => {
  const alert = detailedAlert({
    channels: [{ id: 'c1', name: '#oncall', kind: 'slack' }],
  });
  const failed = { type: 'check', kind: 'error', reason: 'Prometheus did not answer' } as const;
  const entries: AlertTimelineEntry[] = [
    {
      type: 'check',
      id: 'c3',
      kind: 'recovered',
      at: 30,
      reason: null,
      notified: true,
      quiet: false,
    },
    { ...failed, id: 'c2', at: 20, notified: true, quiet: false },
    { ...failed, id: 'c1', at: 10, notified: false, quiet: true },
  ];
  expect(timeline(entries, alert, 100).map((entry) => [entry.at, entry.text, entry.tone])).toEqual([
    [30, 'Can be checked again · notified #oncall', 'ok'],
    [20, 'Cannot be checked: Prometheus did not answer · notified #oncall', 'danger'],
    [10, 'Cannot be checked: Prometheus did not answer · held back by quiet hours', 'danger'],
  ]);
});
