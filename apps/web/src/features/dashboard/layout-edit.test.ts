import { describe, expect, test } from 'bun:test';
import type { DashboardLayout } from '@quanthea/shared';
import {
  cellsOf,
  hidePanel,
  layoutChanged,
  placePanel,
  resizePanel,
  settle,
  setWidth,
  showPanel,
  stepPanel,
} from './layout-edit.ts';

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
  test('a panel dragged up goes before those it passes the middle of', () => {
    const moved = places(placePanel(layout, 'c', { x: 0, y: 1 }, false));
    expect(moved.c).toEqual({ x: 0, y: 0, w: 12, h: 4 });
    expect(moved.a).toEqual({ x: 0, y: 4, w: 6, h: 3 });
    expect(moved.b).toEqual({ x: 6, y: 4, w: 6, h: 3 });
    expect(places(placePanel(layout, 'c', { x: 0, y: 2 }, false)).c).toEqual(
      layout.panels[2]?.grid,
    );
  });

  test('a panel dragged down changes places once its foot passes the middle of the next', () => {
    expect(places(placePanel(layout, 'a', { x: 0, y: 2 }, true)).a).toEqual({
      x: 0,
      y: 0,
      w: 6,
      h: 3,
    });
    const passed = places(placePanel(layout, 'a', { x: 0, y: 3 }, true));
    expect(passed.c).toEqual({ x: 0, y: 3, w: 12, h: 4 });
    expect(passed.a).toEqual({ x: 0, y: 7, w: 6, h: 3 });
    expect(passed.gone).toEqual({ x: 0, y: 0, w: 12, h: 2 });
  });

  test('a dragged panel rises as far as it goes, never past the foot of the others', () => {
    expect(places(placePanel(layout, 'a', { x: 0, y: 20 }, true)).a).toEqual({
      x: 0,
      y: 7,
      w: 6,
      h: 3,
    });
  });

  test('the arrow keys move a panel to the next place it can take', () => {
    expect(places(stepPanel(layout, 'a', { x: 0, y: 1 })).a).toEqual({ x: 0, y: 7, w: 6, h: 3 });
    expect(places(stepPanel(layout, 'c', { x: 0, y: -1 })).c).toEqual({ x: 0, y: 0, w: 12, h: 4 });
    expect(stepPanel(layout, 'c', { x: 0, y: 1 })).toEqual(layout);
    expect(places(stepPanel(layout, 'a', { x: 1, y: 0 })).a).toEqual({ x: 1, y: 0, w: 6, h: 3 });
  });

  test('a panel stays on the grid and keeps a usable size', () => {
    expect(places(placePanel(layout, 'a', { x: 9, y: -2 }, false)).a).toEqual({
      x: 6,
      y: 0,
      w: 6,
      h: 3,
    });
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
    expect(layoutChanged(layout, placePanel(layout, 'c', { x: 0, y: 0 }, false))).toBe(true);
  });
});

describe('hiding, showing and widths', () => {
  test('a hidden panel takes no space and comes back to its place', () => {
    const hidden = hidePanel(layout, 'a');
    expect(places(hidden).c).toEqual({ x: 0, y: 3, w: 12, h: 4 });
    expect(hidden.panels.find((panel) => panel.id === 'a')?.hidden).toBe(true);
    const shown = places(showPanel(hidePanel(layout, 'c'), 'c'));
    expect(shown.c).toEqual({ x: 0, y: 3, w: 12, h: 4 });
  });

  test('a shown panel takes its place back, the others making room', () => {
    const shown = places(showPanel(layout, 'gone'));
    expect(shown.gone).toEqual({ x: 0, y: 0, w: 12, h: 2 });
    expect(shown.a).toEqual({ x: 0, y: 2, w: 6, h: 3 });
  });

  test('full width and half width keep the panel on its row', () => {
    const full = places(setWidth(layout, 'b', 'full'));
    expect(full.b).toEqual({ x: 0, y: 0, w: 12, h: 3 });
    expect(full.a).toEqual({ x: 0, y: 3, w: 6, h: 3 });
    expect(places(setWidth(layout, 'c', 'half')).c).toEqual({ x: 0, y: 3, w: 6, h: 4 });
  });
});
