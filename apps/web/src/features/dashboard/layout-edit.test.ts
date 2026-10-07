import { describe, expect, test } from 'bun:test';
import type { DashboardLayout } from '@quanthea/shared';
import { cellsOf, layoutChanged, movePanel, resizePanel, settle } from './layout-edit.ts';

/** Two panels side by side, a wide one under them, and a hidden one. */
const layout: DashboardLayout = {
  panels: [
    { id: 'a', grid: { x: 0, y: 0, w: 6, h: 3 }, hidden: false },
    { id: 'b', grid: { x: 6, y: 0, w: 6, h: 3 }, hidden: false },
    { id: 'c', grid: { x: 0, y: 3, w: 12, h: 4 }, hidden: false },
    { id: 'gone', grid: { x: 0, y: 0, w: 12, h: 2 }, hidden: true },
  ],
};

/**
 * The places of a layout's panels, by id.
 *
 * @param result - The layout.
 * @returns Each panel's place.
 */
function places(result: DashboardLayout) {
  return Object.fromEntries(result.panels.map((panel) => [panel.id, panel.grid]));
}

describe('arranging a dashboard by hand', () => {
  test('a moved panel stays where it is put, and the others make room', () => {
    const moved = places(movePanel(layout, 'c', { x: 0, y: 0 }));
    expect(moved.c).toEqual({ x: 0, y: 0, w: 12, h: 4 });
    expect(moved.a).toEqual({ x: 0, y: 4, w: 6, h: 3 });
    expect(moved.b).toEqual({ x: 6, y: 4, w: 6, h: 3 });
  });

  test('panels rise into a gap, and a hidden one keeps its place', () => {
    const moved = places(movePanel(layout, 'a', { x: 0, y: 20 }));
    expect(moved.a).toEqual({ x: 0, y: 20, w: 6, h: 3 });
    expect(moved.c).toEqual({ x: 0, y: 3, w: 12, h: 4 });
    expect(moved.gone).toEqual({ x: 0, y: 0, w: 12, h: 2 });
    // Let go, the moved panel rises too.
    const settled = places(settle(movePanel(layout, 'a', { x: 0, y: 20 })));
    expect(settled.a).toEqual({ x: 0, y: 7, w: 6, h: 3 });
  });

  test('a panel stays on the grid and keeps a usable size', () => {
    expect(places(movePanel(layout, 'a', { x: 9, y: -2 })).a).toEqual({ x: 6, y: 0, w: 6, h: 3 });
    expect(places(resizePanel(layout, 'b', { w: 9, h: 0 })).b).toEqual({ x: 6, y: 0, w: 6, h: 2 });
    expect(places(resizePanel(layout, 'a', { w: 1, h: 99 })).a).toEqual({
      x: 0,
      y: 0,
      w: 2,
      h: 40,
    });
  });

  test('a drag crosses the nearest whole cells', () => {
    const metrics = { columnWidth: 64, rowHeight: 40, gap: 16 };
    expect(cellsOf(130, -60, metrics)).toEqual({ columns: 2, rows: -1 });
    expect(cellsOf(30, 20, metrics)).toEqual({ columns: 0, rows: 0 });
  });

  test('tells whether anything changed', () => {
    expect(layoutChanged(layout, settle(layout))).toBe(false);
    expect(layoutChanged(layout, movePanel(layout, 'c', { x: 0, y: 0 }))).toBe(true);
  });
});
