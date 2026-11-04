import { describe, expect, test } from 'bun:test';
import { dashboardSpecSchema } from '@quanthea/shared';
import { checkLinks, withLinkShape } from './check-links.ts';

const grid = { x: 0, y: 0, w: 6, h: 4 };
const query = { refId: 'A', connector: 'shop', language: 'sql', sql: 'SELECT 1' };

/**
 * A spec with a table of browsers and a stat, each with the link given.
 *
 * @param link - The link of the table's browser column.
 * @param statLink - The link of the stat.
 * @returns The spec.
 */
function specWith(link: object, statLink?: object) {
  return dashboardSpecSchema.parse({
    specVersion: 1,
    title: 'Browsers',
    time: { from: 'now-6h', to: 'now' },
    variables: [{ kind: 'custom', name: 'env', options: ['prod'], default: 'prod' }],
    panels: [
      {
        id: 'browsers',
        title: 'Browsers',
        grid,
        queries: [query],
        view: {
          kind: 'table',
          ref: 'A',
          columns: [{ field: 'browser', link }, { field: 'plays' }],
        },
      },
      {
        id: 'plays',
        title: 'Plays',
        grid: { ...grid, x: 6 },
        queries: [query],
        view: { kind: 'stat', ref: 'A', reduce: 'sum', format: { $fmt: 'number' }, link: statLink },
      },
    ],
  });
}

const detail = { id: 'browser-detail', title: 'Browser detail', variables: ['browser', 'env'] };

describe('the links of a spec', () => {
  test('read a column the table shows and a variable declared here, whatever is pinned', () => {
    const link = { dashboard: 'browser-detail', variables: { browser: { column: 'browser' } } };
    expect(checkLinks(specWith(link, { dashboard: 'browser-detail' }))).toEqual([]);
    const wrong = { dashboard: 'x', variables: { a: { column: 'nope' }, b: { variable: 'zone' } } };
    const statRow = { dashboard: 'x', variables: { a: { column: 'plays' } } };
    expect(checkLinks(specWith(wrong, statRow)).map((issue) => issue.message)).toEqual([
      'The table shows no column "nope".',
      'No variable $zone on this dashboard to pass on.',
      'A stat has no row to read a column from: pass a variable or a fixed value.',
    ]);
  });

  test('open a pinned dashboard with the variables named, when the spec is written', () => {
    const link = { dashboard: 'browser-detail', variables: { browser: { column: 'browser' } } };
    expect(checkLinks(specWith(link), [detail])).toEqual([]);
    const other = { dashboard: 'gone', variables: {} };
    expect(checkLinks(specWith(other), [detail])).toEqual([
      {
        path: 'panels[0].view.columns[0].link.dashboard',
        message: 'No pinned dashboard gone: the pinned ones are browser-detail (Browser detail).',
      },
    ]);
    const unknown = { dashboard: 'browser-detail', variables: { device: 'tv' } };
    expect(checkLinks(specWith(unknown), [detail])[0]?.message).toBe(
      'Browser detail has no variable $device; it has $browser, $env.',
    );
  });
  test('tell a link of the wrong form what a link holds and what is pinned', () => {
    const issues = [
      { path: 'panels[3].view.columns[2].link', message: 'Invalid input' },
      { path: 'panels[7].view', message: 'Unrecognized key: "mappings"' },
    ];
    const [link, other] = withLinkShape(issues, [detail]);
    expect(link?.message).toStartWith('A link is { "dashboard": id');
    expect(link?.message).toEndWith('; the pinned ones are browser-detail (Browser detail).');
    expect(other).toEqual(issues[1]);
    expect(withLinkShape(issues)[0]?.message).not.toContain('pinned ones');
  });

  test('read a link to an address from the cell by default, and a stat from a variable', () => {
    const page = { url: 'https://docs.example.com/b/{value}' };
    expect(checkLinks(specWith(page, { url: 'https://docs.example.com/' }), [])).toEqual([]);
    const stat = specWith(page, page);
    expect(checkLinks(stat).map((issue) => issue.path)).toEqual(['panels[1].view.link.value']);
    const chosen = specWith(
      { ...page, value: { column: 'plays' } },
      { ...page, value: { variable: 'env' } },
    );
    expect(checkLinks(chosen)).toEqual([]);
    const unknown = specWith({ ...page, value: { variable: 'region' } });
    expect(checkLinks(unknown)[0]?.message).toBe(
      'No variable $region on this dashboard to pass on.',
    );
  });
  test('let a stat over a breakdown read its row', () => {
    const spec = specWith({ dashboard: 'browser-detail' });
    const plays = spec.panels[1];
    if (plays?.view.kind !== 'stat') throw new Error('No stat.');
    const link = { dashboard: 'd', variables: { browser: { column: 'browser' } }, keepTime: true };
    plays.view = { ...plays.view, each: 'browser', link };
    expect(checkLinks(spec)).toEqual([]);
  });
});
