import { describe, expect, test } from 'bun:test';
import type { DashboardSpec, Panel } from './dashboard.ts';
import { applyLayout, type DashboardLayout, layoutProblems, packLayout } from './layout.ts';

/**
 * A stat panel at a place, in a section.
 *
 * @param id - Its id.
 * @param y - Its row.
 * @param section - Its section, if any.
 * @returns The panel.
 */
function panel(id: string, y: number, section?: string): Panel {
  return {
    id,
    title: id,
    grid: { x: 0, y, w: 12, h: 3 },
    queries: [{ refId: 'A', connector: 'prom', language: 'promql', expr: 'up' }],
    view: { kind: 'stat', ref: 'A', reduce: 'last', format: { $fmt: 'number' } },
    ...(section ? { section } : {}),
  };
}

/** A dashboard with a folded section that repeats over a platform. */
const spec = {
  specVersion: 1,
  title: 'Apps',
  time: { from: 'now-1h', to: 'now' },
  variables: [{ name: 'platform', kind: 'custom', options: ['ios', 'android'], multi: true }],
  annotations: [],
  colors: [],
  panels: [panel('errors', 0), panel('crashes', 3, 'apps'), panel('installs', 6, 'apps')],
  sections: [{ id: 'apps', title: 'Apps', folded: true, repeat: 'platform' }],
} as unknown as DashboardSpec;

/** A layout that renames the section, adds one, and moves two panels. */
const layout: DashboardLayout = {
  sections: [
    { id: 'health', title: 'Health' },
    { id: 'apps', title: 'Per platform' },
  ],
  panels: [
    { id: 'errors', grid: { x: 0, y: 0, w: 12, h: 3 }, hidden: false, section: 'health' },
    { id: 'crashes', grid: { x: 0, y: 0, w: 12, h: 3 }, hidden: false, section: 'apps' },
    { id: 'installs', grid: { x: 0, y: 0, w: 12, h: 3 }, hidden: false },
  ],
};

describe('the sections of a layout', () => {
  test('order and name the sections, and keep what the spec says of each besides its title', () => {
    const shown = applyLayout(spec, layout).spec;
    expect(shown.sections).toEqual([
      { id: 'health', title: 'Health' },
      { id: 'apps', title: 'Per platform', folded: true, repeat: 'platform' },
    ]);
    expect(shown.panels.map((each) => [each.id, each.section])).toEqual([
      ['errors', 'health'],
      ['crashes', 'apps'],
      ['installs', undefined],
    ]);
  });

  test('pack each section on its own rows, so two sections may share a row', () => {
    const shown = applyLayout(spec, layout).spec;
    expect(shown.panels.map((each) => each.grid.y)).toEqual([0, 0, 0]);
    expect(packLayout(layout).panels.map((each) => each.grid.y)).toEqual([0, 0, 0]);
    expect(packLayout(layout).sections).toEqual(layout.sections);
  });

  test('leave the spec sections when the layout sets none', () => {
    const plain: DashboardLayout = {
      panels: layout.panels.map(({ section: _left, ...entry }) => entry),
    };
    expect(applyLayout(spec, plain).spec.sections).toEqual(spec.sections);
    expect(layoutProblems(spec, plain)).toEqual([]);
  });

  test('are refused when a panel names one the layout does not set, or on a report', () => {
    expect(layoutProblems(spec, layout)).toEqual([]);
    const stray = { ...layout, sections: [{ id: 'apps', title: 'Apps' }] };
    expect(layoutProblems(spec, stray)).toEqual(['No section "health": they are apps.']);
    const unset = { panels: layout.panels };
    expect(layoutProblems(spec, unset)).toEqual([
      'A panel names a section, but the layout sets none.',
    ]);
    expect(layoutProblems({ panels: spec.panels }, layout)).toEqual([
      'Only a dashboard has sections.',
    ]);
  });
});
