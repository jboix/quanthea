import { expect, test } from 'bun:test';
import { detailedAlert } from './test-alerts.ts';
import { timeline } from './timeline.ts';

const event = {
  version: 3,
  seriesKey: '{service="checkout-svc"}',
  labels: { service: 'checkout-svc' },
  message: null,
  notified: false,
};

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
    events: [
      { ...event, from: 'pending', to: 'firing', at: 50, value: 0.034, notified: true },
      { ...event, from: 'ok', to: 'pending', at: 40, value: 0.031 },
      { ...event, from: 'firing', to: 'ok', at: 10, value: 0.01, notified: true },
      { ...event, labels: {}, from: 'ok', to: 'error', at: 5, value: null, message: 'timeout' },
    ],
    activity: [
      { action: 'mute', at: 60, by: 'Ana', version: null, until: null },
      { action: 'activate', at: 20, by: 'Ana', version: 3, until: null },
    ],
  });
  expect(timeline(alert, 100).map((entry) => [entry.at, entry.text, entry.tone])).toEqual([
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
    checks: [
      { kind: 'recovered', at: 30, reason: null, notified: true },
      { kind: 'error', at: 20, reason: 'Prometheus did not answer', notified: true },
      { kind: 'error', at: 10, reason: 'Prometheus did not answer', notified: false },
    ],
  });
  expect(timeline(alert, 100).map((entry) => [entry.at, entry.text, entry.tone])).toEqual([
    [30, 'Can be checked again · notified #oncall', 'ok'],
    [20, 'Cannot be checked: Prometheus did not answer · notified #oncall', 'danger'],
    [10, 'Cannot be checked: Prometheus did not answer', 'danger'],
  ]);
});
