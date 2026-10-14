import { expect, test } from 'bun:test';
import type { Frame, TableView as TableViewSpec } from '@quanthea/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { TableView } from './table-view.tsx';
import { columnPercents } from './table-widths.tsx';

const frame: Frame = {
  refId: 'A',
  fields: [
    { name: 'browser', type: 'string' },
    { name: 'median', type: 'number' },
  ],
  values: [
    ['Firefox', 'Safari'],
    [1.2, 4.5],
  ],
  meta: { rowCount: 2, truncated: false, durationMs: 1 },
};

/**
 * Renders the table with thresholds on its median column.
 *
 * @param toneAs - How the column draws a tone, if it says.
 * @returns The markup.
 */
function render(toneAs?: 'text' | 'background'): string {
  const view: TableViewSpec = {
    kind: 'table',
    ref: 'A',
    columns: [
      { field: 'browser' },
      {
        field: 'median',
        ...(toneAs ? { toneAs } : {}),
        mappings: [
          { match: { to: 2 }, tone: 'good' },
          { match: { from: 4 }, tone: 'bad' },
        ],
      },
    ],
  };
  const queries = [{ refId: 'A', frames: [frame], error: null }];
  return renderToStaticMarkup(<TableView view={view} queries={queries} timeZone="UTC" />);
}

test('a cell with a tone names its design token, and a cell without one is plain text', () => {
  const html = render();
  expect(html).toContain('<td data-align="left">Firefox</td>');
  expect(html).toContain('style="--tone:var(--color-ok)"');
  expect(html).toContain('style="--tone:var(--color-danger)"');
  expect(html.match(/data-tone-as="text"/g)).toHaveLength(2);
  expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
});

test('a column can draw its tones as a tint behind the text', () => {
  expect(render('background').match(/data-tone-as="background"/g)).toHaveLength(2);
});

test('headers sort on a click and say how they sort, and a short table has no filters or pages', () => {
  const html = render();
  expect(html.match(/aria-sort="none"/g)).toHaveLength(2);
  expect(html).toContain('<button type="button"');
  expect(html).not.toContain('aria-label="Filter browser"');
  expect(html).not.toContain('Table pages');
});

test('a table longer than its page has a filter per column and a pager', () => {
  const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const long: Frame = {
    refId: 'A',
    fields: [{ name: 'name', type: 'string' }],
    values: [names],
    meta: { rowCount: names.length, truncated: false, durationMs: 1 },
  };
  const view: TableViewSpec = {
    kind: 'table',
    ref: 'A',
    columns: [{ field: 'name' }],
    pageSize: 5,
  };
  const queries = [{ refId: 'A', frames: [long], error: null }];
  const html = renderToStaticMarkup(<TableView view={view} queries={queries} timeZone="UTC" />);
  expect(html).toContain('aria-label="Filter name"');
  expect(html).toContain('aria-label="Table pages"');
  expect(html).toContain('1–5 of 7');
  expect(html.match(/<td /g)).toHaveLength(5);
});

test('columns that set widths share the table out of a colgroup, and a long cell keeps its title', () => {
  const view: TableViewSpec = {
    kind: 'table',
    ref: 'A',
    columns: [
      { field: 'browser', width: 'wide' },
      { field: 'median', width: 'narrow' },
    ],
  };
  const queries = [{ refId: 'A', frames: [frame], error: null }];
  const html = renderToStaticMarkup(<TableView view={view} queries={queries} timeZone="UTC" />);
  expect(html).toContain('<col data-width="wide" style="width:80%"/>');
  expect(html).toContain('<col data-width="narrow" style="width:20%"/>');
  expect(html).toContain('data-fixed="true"');
  expect(html).toContain('title="Firefox"');
});

test('a table whose columns set no width has no colgroup', () => {
  const html = render();
  expect(html).not.toContain('<colgroup');
  expect(html).not.toContain('data-fixed');
});

test('a column with no width takes a medium share beside one that sets one', () => {
  expect(
    columnPercents([
      { label: 'a', align: 'left', width: 'narrow' },
      { label: 'b', align: 'left' },
      { label: 'c', align: 'left', width: 'wide' },
    ]),
  ).toEqual([14.3, 28.6, 57.1]);
});
