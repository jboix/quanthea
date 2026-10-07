import { describe, expect, test } from 'bun:test';
import type { DashboardSpec, Panel } from './dashboard.ts';
import {
  applyLayout,
  type DashboardLayout,
  dashboardLayoutSchema,
  layoutProblems,
  packGrid,
  packLayout,
  specLayout,
} from './layout.ts';

/**
 * A stat panel at a place.
 *
 * @param id - Its id.
 * @param grid - Its place.
 * @returns The panel.
 */
function panel(id: string, grid: Panel['grid']): Panel {
  return {
    id,
    title: id,
    grid,
    queries: [{ refId: 'A', connector: 'prom', language: 'promql', expr: 'up' }],
    view: { kind: 'stat', ref: 'A', reduce: 'last', format: { $fmt: 'number' } },
  };
}

/** Three panels: two side by side, one under them. */
const spec = {
  specVersion: 1,
  title: 'Checkout',
  time: { from: 'now-1h', to: 'now' },
  variables: [],
  annotations: [],
  panels: [
    panel('errors', { x: 0, y: 0, w: 6, h: 3 }),
    panel('latency', { x: 6, y: 0, w: 6, h: 3 }),
    panel('orders', { x: 0, y: 3, w: 12, h: 5 }),
  ],
} as DashboardSpec;

describe('packGrid', () => {
  test('moves a panel down until it overlaps none placed before it', () => {
    const packed = packGrid([
      { grid: { x: 0, y: 0, w: 6, h: 3 } },
      { grid: { x: 3, y: 1, w: 6, h: 2 } },
    ]);
    expect(packed[1]?.grid).toEqual({ x: 3, y: 3, w: 6, h: 2 });
  });
});

describe('a layout', () => {
  test('starts from the spec: every panel at its place, shown', () => {
    const layout = specLayout(spec);
    expect(layout.panels.map((entry) => [entry.id, entry.hidden])).toEqual([
      ['errors', false],
      ['latency', false],
      ['orders', false],
    ]);
    expect(applyLayout(spec, layout).spec.panels).toEqual(spec.panels);
  });

  test('shows the panels at its places and leaves the hidden ones out', () => {
    const layout: DashboardLayout = {
      panels: [
        { id: 'errors', grid: { x: 0, y: 0, w: 12, h: 4 }, hidden: false },
        { id: 'latency', grid: { x: 6, y: 0, w: 6, h: 3 }, hidden: true },
        { id: 'orders', grid: { x: 0, y: 4, w: 6, h: 5 }, hidden: false },
      ],
    };
    const shown = applyLayout(spec, layout);
    expect(shown.hidden).toEqual(['latency']);
    expect(shown.spec.panels.map((each) => [each.id, each.grid])).toEqual([
      ['errors', { x: 0, y: 0, w: 12, h: 4 }],
      ['orders', { x: 0, y: 4, w: 6, h: 5 }],
    ]);
    expect(shown.spec.title).toBe('Checkout');
  });

  test('is the spec itself when there is none', () => {
    expect(applyLayout(spec, undefined)).toEqual({ spec, hidden: [] });
  });

  test('packs the shown panels, and a hidden one takes no space', () => {
    const packed = packLayout({
      panels: [
        { id: 'errors', grid: { x: 0, y: 0, w: 12, h: 3 }, hidden: true },
        { id: 'latency', grid: { x: 0, y: 0, w: 12, h: 3 }, hidden: false },
        { id: 'orders', grid: { x: 0, y: 1, w: 12, h: 5 }, hidden: false },
      ],
    });
    expect(packed.panels.map((entry) => entry.grid.y)).toEqual([0, 0, 3]);
  });

  test('names every panel of its version once and no other, and shows one at least', () => {
    expect(layoutProblems(spec, specLayout(spec))).toEqual([]);
    const [first, second] = specLayout(spec).panels;
    if (!first || !second) throw new Error('Expected panels.');
    const wrong: DashboardLayout = {
      panels: [first, first, { ...second, id: 'nope' }],
    };
    expect(layoutProblems(spec, wrong)).toEqual([
      'Panels named twice: errors.',
      'No such panels: nope.',
      'Panels left out: latency, orders.',
    ]);
    const allHidden = {
      panels: specLayout(spec).panels.map((entry) => ({ ...entry, hidden: true })),
    };
    expect(layoutProblems(spec, allHidden)).toEqual(['Show at least one panel.']);
  });

  test('refuses a place off the grid', () => {
    const offGrid = {
      panels: [{ id: 'errors', grid: { x: 10, y: 0, w: 4, h: 3 }, hidden: false }],
    };
    expect(dashboardLayoutSchema.safeParse(offGrid).success).toBe(false);
  });
});
