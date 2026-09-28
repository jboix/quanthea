import { describe, expect, test } from 'bun:test';
import { type DashboardSpec, dashboardSpecSchema } from './dashboard.ts';
import { diffLines, diffSpecs } from './diff.ts';

/**
 * A spec with the given panels.
 *
 * @param panels - Each panel's id, title and PromQL expression.
 * @returns The spec.
 */
function specWith(...panels: [string, string, string][]): DashboardSpec {
  return dashboardSpecSchema.parse({
    specVersion: 1,
    title: 'Checkout',
    time: { from: 'now-6h', to: 'now' },
    panels: panels.map(([id, title, expr], index) => ({
      id,
      title,
      grid: { x: 0, y: index * 3, w: 12, h: 3 },
      queries: [{ refId: 'A', connector: 'prom', language: 'promql', expr }],
      view: { kind: 'stat', ref: 'A', reduce: 'max', format: { $fmt: 'percent' } },
    })),
  });
}

describe('diffSpecs', () => {
  test('classifies panels by id and lists the changed fields', () => {
    const before = specWith(
      ['rate', 'Error rate', 'up{service=~"$service"}'],
      ['gone', 'Old', 'up'],
    );
    const after = specWith(
      ['rate', 'Error rate', 'up{service=~"checkout-svc|payments-svc"}'],
      ['new', 'New', 'up'],
    );
    const diff = diffSpecs(before, after);
    expect(diff.panels.map((panel) => [panel.id, panel.status])).toEqual([
      ['rate', 'changed'],
      ['new', 'added'],
      ['gone', 'removed'],
    ]);
    expect(diff.panels[0]?.changes).toEqual([
      {
        path: 'queries[0].expr',
        before: 'up{service=~"$service"}',
        after: 'up{service=~"checkout-svc|payments-svc"}',
      },
    ]);
    expect(diff.dashboard).toEqual([]);
  });

  test('reports a moved panel and dashboard fields', () => {
    const before = specWith(['rate', 'Error rate', 'up']);
    const after = { ...specWith(['rate', 'Error rate', 'up']), title: 'Checkout incident' };
    const moved = {
      ...after,
      panels: after.panels.map((panel) => ({ ...panel, grid: { ...panel.grid, y: 4 } })),
    };
    const diff = diffSpecs(before, moved);
    expect(diff.panels[0]?.changes).toEqual([{ path: 'grid.y', before: '0', after: '4' }]);
    expect(diff.dashboard).toEqual([
      { path: 'title', before: 'Checkout', after: 'Checkout incident' },
    ]);
  });

  test('calls unchanged panels the same', () => {
    const spec = specWith(['rate', 'Error rate', 'up']);
    expect(diffSpecs(spec, spec).panels).toEqual([
      { id: 'rate', title: 'Error rate', status: 'same', changes: [] },
    ]);
  });
});

describe('diffLines', () => {
  test('keeps common lines and marks the rest', () => {
    expect(
      diffLines('sum by (service) (\n  rate(x[1m])\n)', 'sum by (service) (\n  rate(x[5m])\n)'),
    ).toEqual([
      { kind: ' ', text: 'sum by (service) (' },
      { kind: '-', text: '  rate(x[1m])' },
      { kind: '+', text: '  rate(x[5m])' },
      { kind: ' ', text: ')' },
    ]);
    expect(diffLines('a', 'a')).toEqual([{ kind: ' ', text: 'a' }]);
    expect(diffLines('', 'b')).toEqual([
      { kind: '-', text: '' },
      { kind: '+', text: 'b' },
    ]);
  });
});
