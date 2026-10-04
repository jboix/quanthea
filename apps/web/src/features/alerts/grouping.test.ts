import { describe, expect, test } from 'bun:test';
import { alertSections, alertStatus, filterCounts, filterFrom, firingCount } from './grouping.ts';
import { listedAlert } from './test-alerts.ts';

const none = { ok: 0, pending: 0, firing: 0, no_data: 0, error: 0 };

const firing = listedAlert({
  id: 'firing',
  title: 'Checkout 5xx rate',
  states: { ...none, firing: 1, ok: 3 },
  lead: { labels: { service: 'checkout-svc' }, state: 'firing', since: 50, value: 0.034 },
});
const olderFiring = listedAlert({
  id: 'older',
  title: 'Disk space',
  states: { ...none, firing: 1 },
  lead: { labels: { host: 'db-2' }, state: 'firing', since: 10, value: 0.07 },
});
const pending = listedAlert({ id: 'pending', title: 'Payments', states: { ...none, pending: 1 } });
const ok = listedAlert({ id: 'ok', title: 'Latency' });
const failing = listedAlert({ id: 'failing', title: 'Orders', states: { ...none, error: 1 } });
const muted = listedAlert({
  id: 'muted',
  title: 'Cart errors',
  muted: { until: 5, by: 'Ana', at: 1 },
  states: { ...none, firing: 1 },
});
const draft = listedAlert({ id: 'draft', title: 'New one', activeVersion: null, latestVersion: 1 });
const stopped = listedAlert({ id: 'stopped', title: 'Old one', deactivated: true });
const all = [ok, pending, firing, olderFiring, failing, muted, draft, stopped];

test('an alert stands as a draft, deactivated, muted, or its worst state', () => {
  expect(all.map(alertStatus)).toEqual([
    'ok',
    'pending',
    'firing',
    'firing',
    'error',
    'muted',
    'draft',
    'deactivated',
  ]);
});

test('each filter counts its alerts; OK leaves the muted ones to Muted', () => {
  expect(filterCounts(all)).toEqual({
    all: 8,
    firing: 2,
    pending: 1,
    ok: 2,
    muted: 1,
    drafts: 1,
  });
});

describe('the sections', () => {
  test('Firing (the latest first), Pending, OK with the muted, Drafts, Deactivated', () => {
    const sections = alertSections(all, 'all', '');
    expect(sections.map((section) => [section.id, section.alerts.map((each) => each.id)])).toEqual([
      ['firing', ['firing', 'older']],
      ['pending', ['pending']],
      ['ok', ['muted', 'ok', 'failing']],
      ['drafts', ['draft']],
      ['deactivated', ['stopped']],
    ]);
  });

  test('a filter keeps its alerts, and empty sections go', () => {
    const sections = alertSections(all, 'muted', '');
    expect(sections.map((section) => section.id)).toEqual(['ok']);
    expect(sections[0]?.alerts.map((each) => each.id)).toEqual(['muted']);
  });

  test('the search finds every word in the title, the condition or the worst series', () => {
    const found = (words: string) =>
      alertSections(all, 'all', words).flatMap((section) => section.alerts.map((each) => each.id));
    expect(found('checkout')).toEqual(['firing']);
    expect(found('DISK db-2')).toEqual(['older']);
    expect(found('above 2%')).toHaveLength(8);
    expect(found('nothing like it')).toEqual([]);
  });
});

test('the rail counts the active alerts with a series firing, muted or not', () => {
  expect(firingCount(all)).toBe(3);
  expect(firingCount([{ ...firing, deactivated: true }])).toBe(0);
});

test('a filter comes from the URL, all for anything else', () => {
  expect(filterFrom('pending')).toBe('pending');
  expect(filterFrom('everything')).toBe('all');
  expect(filterFrom(null)).toBe('all');
});
