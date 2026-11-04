import { describe, expect, test } from 'bun:test';
import type { Panel } from '@quanthea/shared';
import { panelJoins } from './panel-joins.ts';

/**
 * A panel at a place on the grid; only its id and grid matter here.
 *
 * @param id - The id.
 * @param x - The first column.
 * @param y - The first row.
 * @param w - The width.
 * @param h - The height.
 * @returns The panel.
 */
function at(id: string, x: number, y: number, w: number, h: number): Panel {
  return { id, grid: { x, y, w, h } } as Panel;
}

describe('the joins of a tight grid', () => {
  test('a panel alone shares no edge and keeps every corner', () => {
    expect(panelJoins([at('a', 0, 0, 12, 4)]).get('a')).toEqual({
      left: false,
      top: false,
      rounded: [true, true, true, true],
    });
  });

  test('two panels side by side above a full one round only the block corners', () => {
    const joins = panelJoins([at('a', 0, 0, 6, 4), at('b', 6, 0, 6, 4), at('c', 0, 4, 12, 4)]);
    expect(joins.get('a')).toEqual({
      left: false,
      top: false,
      rounded: [true, false, false, false],
    });
    expect(joins.get('b')).toEqual({
      left: true,
      top: false,
      rounded: [false, true, false, false],
    });
    expect(joins.get('c')).toEqual({ left: false, top: true, rounded: [false, false, true, true] });
  });

  test('a corner beside a gap in the grid stays rounded', () => {
    const joins = panelJoins([at('a', 0, 0, 6, 4), at('b', 0, 4, 12, 4)]);
    expect(joins.get('a')?.rounded).toEqual([true, true, false, false]);
    expect(joins.get('b')?.rounded).toEqual([false, true, true, true]);
  });
});
