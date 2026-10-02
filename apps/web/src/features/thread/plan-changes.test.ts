import { describe, expect, test } from 'bun:test';
import type { Plan } from '@quanthea/shared';
import { changeRows, type DraftPanel, isChangePlan, panelMarks } from './plan-changes.ts';

const draft: DraftPanel[] = [
  { id: 'error-rate', title: 'Error rate', query: 'sum by (service) (rate(errors[5m]))' },
  { id: 'p95', title: 'p95 latency', query: 'histogram_quantile(0.95, …)' },
  { id: 'failed-orders', title: 'Failed orders', query: 'SELECT count(*) FROM orders' },
  { id: 'top-codes', title: 'Top 5xx codes', query: 'topk(5, …)' },
];

const plan: Plan = {
  title: 'Checkout errors · 7 days by region',
  variables: [],
  changes: ['time range: last 7 days'],
  panels: [
    {
      kind: 'line',
      title: 'Error rate by region',
      language: 'promql',
      connector: 'prometheus-dev',
      replaces: 'error-rate',
      change: 'by region, step 15m',
      query: 'sum by (region) (rate(errors[15m]))',
    },
    { kind: 'stat', title: 'Deploys in range', language: 'sql', connector: 'postgres-orders' },
  ],
  removes: ['top-codes'],
};

describe('a plan as changes to the draft', () => {
  test('lists changes outside panels, changed, new and removed panels, and how many it keeps', () => {
    expect(changeRows(plan, draft)).toEqual([
      { tag: 'changed', title: 'time range: last 7 days' },
      {
        tag: 'changed',
        title: 'Error rate by region',
        note: 'by region, step 15m',
        before: 'sum by (service) (rate(errors[5m]))',
        after: 'sum by (region) (rate(errors[15m]))',
      },
      { tag: 'new', title: 'Deploys in range', kind: 'stat' },
      { tag: 'removed', title: 'Top 5xx codes' },
      { tag: 'same', count: 2 },
    ]);
  });

  test('shows no query diff without the plan’s query, and no kept count without the draft', () => {
    const [, changed] = plan.panels;
    const withoutQuery = {
      ...plan,
      panels: [{ ...plan.panels[0], query: undefined }, changed],
    } as Plan;
    expect(changeRows(withoutQuery, draft)[1]).toEqual({
      tag: 'changed',
      title: 'Error rate by region',
      note: 'by region, step 15m',
    });
    expect(changeRows(plan).at(-1)).toEqual({ tag: 'removed', title: 'top-codes' });
  });

  test('marks each draft panel changed, removed or kept', () => {
    expect(panelMarks(plan, draft)).toEqual({
      'error-rate': { tag: 'changed', note: 'by region, step 15m' },
      p95: { tag: 'same' },
      'failed-orders': { tag: 'same' },
      'top-codes': { tag: 'removed' },
    });
  });

  test('reads a first plan as a list of panels, and any plan on a draft as changes', () => {
    const first: Plan = {
      title: 'T',
      variables: [],
      panels: [plan.panels[1] as Plan['panels'][number]],
    };
    expect(isChangePlan(first, undefined)).toBe(false);
    expect(isChangePlan(first, draft)).toBe(true);
    expect(isChangePlan(plan, undefined)).toBe(true);
  });
});
