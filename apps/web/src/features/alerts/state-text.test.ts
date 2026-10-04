import { describe, expect, test } from 'bun:test';
import { leadWords, muteEnd, rowState, statePill } from './state-text.ts';
import { listedAlert } from './test-alerts.ts';

const minute = 60_000;
const now = new Date(2026, 9, 4, 15, 0).getTime();
const none = { ok: 0, pending: 0, firing: 0, no_data: 0, error: 0 };

const firing = listedAlert({
  states: { ...none, firing: 1, ok: 3 },
  seriesCount: 4,
  lead: {
    labels: { service: 'checkout-svc' },
    state: 'firing',
    since: now - 18 * minute,
    value: 0.034,
  },
});
const pending = listedAlert({
  states: { ...none, pending: 1 },
  lead: { labels: {}, state: 'pending', since: now - 2 * minute, value: 0.03 },
});

describe('the state of a row', () => {
  test('firing and pending say for how long', () => {
    expect(rowState(firing, now)).toEqual({ text: 'Firing 18 min', tone: 'danger' });
    expect(rowState(pending, now)).toEqual({ text: 'Pending 2 of 5 min', tone: 'pending' });
  });

  test('OK says since when, or that it was never evaluated', () => {
    const ok = listedAlert({
      lead: { labels: {}, state: 'ok', since: now - 3 * 86_400_000, value: 0 },
    });
    expect(rowState(ok, now)).toEqual({ text: 'OK 3 d', tone: 'ok' });
    expect(rowState(listedAlert({ evaluatedAt: null, lead: null }), now).text).toBe(
      'Not evaluated yet',
    );
  });

  test('muted, a draft and a deactivated alert say so', () => {
    const until = new Date(2026, 9, 4, 18, 0).getTime();
    expect(rowState({ ...firing, muted: { until, by: 'Ana', at: 1 } }, now).text).toBe(
      'Muted to 18:00',
    );
    expect(rowState({ ...firing, muted: { until: null, by: 'Ana', at: 1 } }, now).text).toBe(
      'Muted',
    );
    expect(rowState(listedAlert({ activeVersion: null, latestVersion: 2 }), now).text).toBe(
      'Draft v2',
    );
    expect(rowState(listedAlert({ deactivated: true }), now).text).toBe('Deactivated');
  });
});

describe('the state pill of the alert page', () => {
  test('names the worst series, muted or not', () => {
    expect(statePill(firing, now)).toEqual({
      text: 'Firing 18 min · checkout-svc',
      tone: 'danger',
    });
    const mutedFiring = { ...firing, muted: { until: null, by: 'Ana', at: 1 } };
    expect(statePill(mutedFiring, now).text).toBe('Firing 18 min · checkout-svc');
    expect(statePill(pending, now).text).toBe('Pending 2 of 5 min');
  });

  test('OK, a draft and a deactivated alert', () => {
    expect(statePill(listedAlert(), now)).toEqual({ text: 'OK', tone: 'ok' });
    expect(statePill(listedAlert({ activeVersion: null }), now).text).toBe('Draft');
    expect(statePill({ ...firing, deactivated: true }, now).text).toBe('Deactivated');
  });

  test('a mute ends at a time, or when someone unmutes', () => {
    expect(muteEnd(new Date(2026, 9, 4, 18, 0).getTime(), now)).toBe('until 18:00');
    expect(muteEnd(null, now)).toBe('until unmuted');
  });
});

test('a row names the worst series, its value, and how many share its state', () => {
  expect(leadWords(firing, '3.4%')).toEqual(['checkout-svc 3.4%', '1 of 4 series']);
  expect(leadWords(pending, '3%')).toEqual(['3%']);
  expect(leadWords(listedAlert(), '1%')).toEqual([]);
});
