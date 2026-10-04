import { describe, expect, test } from 'bun:test';
import type { DashboardSpec, PanelAlert } from '@quanthea/shared';
import {
  alertMarksOf,
  alertSetId,
  listedState,
  panelAlertsOf,
  panelPill,
  pillState,
  selectionOf,
} from './panel-alerts.ts';

/** A spec with a service variable on All by default and an environment variable. */
const spec = {
  specVersion: 1,
  title: 'Checkout incident',
  time: { from: 'now-6h', to: 'now' },
  variables: [
    {
      kind: 'custom',
      name: 'service',
      options: ['payments-svc', 'checkout-svc'],
      default: '$__all',
      multi: true,
      includeAll: true,
    },
    { kind: 'custom', name: 'env', options: ['prod', 'staging'], default: 'prod' },
    { kind: 'interval', name: 'window', options: ['1m', '5m'], default: '1m' },
  ],
  panels: [],
  annotations: [],
} as unknown as DashboardSpec;

/**
 * The Checkout 5xx rate alert: payments firing, checkout pending.
 *
 * @param overrides - Fields to replace.
 * @returns The alert.
 */
function alert(overrides: Partial<PanelAlert> = {}): PanelAlert {
  return {
    id: 'a1',
    title: 'Checkout 5xx rate',
    evaluated: true,
    muted: false,
    threshold: { op: 'above', value: 0.02 },
    format: { $fmt: 'percent', decimals: 1 },
    variables: [{ name: 'env', value: 'prod' }],
    series: [
      { labels: { service: 'payments-svc' }, state: 'firing' },
      { labels: { service: 'checkout-svc' }, state: 'pending' },
      { labels: { service: 'search-svc' }, state: 'ok' },
    ],
    periods: [
      { labels: { service: 'payments-svc' }, from: 100, to: null },
      { labels: { service: 'checkout-svc' }, from: 10, to: 20 },
    ],
    ...overrides,
  };
}

/**
 * The selection for some variable values.
 *
 * @param variables - The chosen values.
 * @returns The selection.
 */
const select = (variables: Record<string, string | string[]> = {}) =>
  selectionOf(spec, { variables, time: undefined });

describe('the pill of a linked panel', () => {
  test('shows the worst state of every series when the panel filters none', () => {
    expect(pillState(alert(), select())).toBe('firing');
  });

  test('follows the series of the chosen value', () => {
    expect(pillState(alert(), select({ service: ['payments-svc'] }))).toBe('firing');
    expect(pillState(alert(), select({ service: ['checkout-svc'] }))).toBe('pending');
    expect(pillState(alert(), select({ service: ['search-svc'] }))).toBeNull();
    expect(pillState(alert(), select({ service: ['search-svc', 'checkout-svc'] }))).toBe('pending');
  });

  test('shows nothing when the alert watches another value of a fixed variable', () => {
    expect(pillState(alert(), select({ env: 'staging' }))).toBeNull();
    expect(pillState(alert(), select({ env: 'prod' }))).toBe('firing');
  });

  test('is quiet when muted: muted only while firing underneath', () => {
    expect(pillState(alert({ muted: true }), select())).toBe('muted');
    expect(pillState(alert({ muted: true }), select({ service: ['checkout-svc'] }))).toBeNull();
  });

  test('shows nothing for an alert not evaluated', () => {
    expect(pillState(alert({ evaluated: false }), select())).toBeNull();
  });

  test('stands for the worst of the panel’s alerts', () => {
    const calm = alert({ id: 'a2', series: [{ labels: {}, state: 'pending' }] });
    expect(panelPill([calm, alert()], select())).toMatchObject({
      state: 'firing',
      alert: { id: 'a1' },
    });
    expect(panelPill([], select())).toBeUndefined();
  });
});

describe('the marks of a linked panel', () => {
  test('draw the threshold in the alert’s format and the firing periods of the selection', () => {
    const marks = alertMarksOf([alert()], select({ service: ['payments-svc'] }), new Set(), 500);
    expect(marks).toEqual({
      thresholds: [{ value: 0.02, label: '2%' }],
      periods: [{ from: 100, to: 500 }],
    });
  });

  test('leave the periods out once the viewer hides the alert’s set', () => {
    const hidden = new Set([alertSetId('a1')]);
    expect(alertMarksOf([alert()], select(), hidden, 500)?.periods).toEqual([]);
  });

  test('draw nothing for an alert watching another value', () => {
    expect(alertMarksOf([alert()], select({ env: 'staging' }), new Set(), 500)).toBeUndefined();
  });
});

describe('panelAlertsOf', () => {
  test('picks the alerts linked to and suggested for a panel', () => {
    const data = {
      alerts: [alert(), alert({ id: 'a2' })],
      links: [{ alertId: 'a1', panelId: 'errors' }],
      suggestions: [{ alertId: 'a2', panelId: 'errors' }],
    };
    const errors = panelAlertsOf(data, 'errors');
    expect(errors.linked.map((each) => each.id)).toEqual(['a1']);
    expect(errors.suggested.map((each) => each.id)).toEqual(['a2']);
    expect(panelAlertsOf(data, 'latency')).toEqual({ linked: [], suggested: [] });
  });
});

describe('the About list of alerts', () => {
  test('says how each alert stands as a whole', () => {
    expect(listedState(alert())).toEqual({ words: 'Firing', tone: 'danger' });
    expect(listedState(alert({ muted: true }))).toEqual({
      words: 'Muted, firing',
      tone: 'neutral',
    });
    const calm = alert({ series: [{ labels: {}, state: 'ok' }] });
    expect(listedState(calm)).toEqual({ words: 'OK', tone: 'ok' });
    expect(listedState({ ...calm, muted: true }).words).toBe('Muted');
    expect(listedState(alert({ series: [{ labels: {}, state: 'pending' }] })).words).toBe(
      'Pending',
    );
    expect(listedState(alert({ evaluated: false })).words).toBe('Not active');
  });
});
