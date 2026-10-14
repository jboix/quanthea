import { describe, expect, test } from 'bun:test';
import type { TableRow } from './table-rows.ts';
import { nextSort, type TableState, tablePage, untouched, withFilter } from './table-state.ts';

/**
 * A row of a browser and its median.
 *
 * @param key - The row's place.
 * @param browser - The browser.
 * @param median - The median, raw.
 * @returns The row, its median written with a unit.
 */
function row(key: number, browser: string, median: number | null): TableRow {
  return {
    key: String(key),
    cells: [
      { value: browser, text: browser },
      { value: median, text: median === null ? '' : `${median} s` },
    ],
  };
}

const rows = [
  row(0, 'Firefox', 9),
  row(1, 'Safari', 10),
  row(2, 'Chrome', 2),
  row(3, 'Edge', null),
];

/**
 * The browsers of a page.
 *
 * @param state - What the viewer did.
 * @param size - The rows of a page.
 * @returns The browsers, in order.
 */
function browsers(state: TableState, size = 10): unknown[] {
  return tablePage(rows, state, size).rows.map((each) => each.cells[0]?.value);
}

describe('a table a viewer works', () => {
  test('keeps the order of the view until a header is clicked', () => {
    expect(browsers(untouched)).toEqual(['Firefox', 'Safari', 'Chrome', 'Edge']);
  });

  test('sorts by raw values, so 10 comes after 9, up then down then as the view had it', () => {
    const up = nextSort(undefined, 1);
    expect(up).toEqual({ column: 1, dir: 'asc' });
    expect(browsers({ ...untouched, sort: up })).toEqual(['Edge', 'Chrome', 'Firefox', 'Safari']);
    const down = nextSort(up, 1);
    expect(browsers({ ...untouched, sort: down })).toEqual(['Safari', 'Firefox', 'Chrome', 'Edge']);
    expect(nextSort(down, 1)).toBeUndefined();
    expect(nextSort(down, 0)).toEqual({ column: 0, dir: 'asc' });
  });

  test('filters on the text shown, in any case, and goes back to the first page', () => {
    const state = withFilter({ ...untouched, offset: 2 }, 0, '  fIRE ');
    expect(state.offset).toBe(0);
    expect(browsers(state)).toEqual(['Firefox']);
    expect(browsers(withFilter(untouched, 1, '10 s'))).toEqual(['Safari']);
    expect(browsers(withFilter(state, 0, ''))).toHaveLength(4);
  });

  test('shows a page at a time', () => {
    const second = tablePage(rows, { ...untouched, offset: 2 }, 2);
    expect(second.rows.map((each) => each.key)).toEqual(['2', '3']);
    expect(second).toMatchObject({ offset: 2, total: 4 });
  });

  test('shows the last page when the rows shrink under the page chosen', () => {
    const page = tablePage(rows.slice(0, 3), { ...untouched, offset: 6 }, 2);
    expect(page).toMatchObject({ offset: 2, total: 3 });
    expect(page.rows.map((each) => each.key)).toEqual(['2']);
  });
});
