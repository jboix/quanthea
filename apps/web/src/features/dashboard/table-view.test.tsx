import { expect, test } from 'bun:test';
import type { Frame, TableView as TableViewSpec } from '@quanthea/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { TableView } from './table-view.tsx';

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
