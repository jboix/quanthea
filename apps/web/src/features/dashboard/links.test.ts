import { expect, test } from 'bun:test';
import { dashboardSpecSchema, defaultExternalHosts, linkSchema } from '@quanthea/shared';
import { hrefOf, panelLinksOf } from './links.ts';

const spec = dashboardSpecSchema.parse({
  specVersion: 1,
  title: 'Browsers',
  time: { from: 'now-6h', to: 'now' },
  variables: [{ kind: 'custom', name: 'env', options: ['prod', 'staging'], default: 'prod' }],
  panels: [],
});

const anyHost = defaultExternalHosts;

/**
 * What a dashboard's links are built from, with the address search and the dashboards pinned.
 *
 * @param search - The address search.
 * @param targets - The dashboards pinned now.
 * @param hosts - The hosts allowed.
 * @returns What the panels' links are built from.
 */
function linksOf(search: string, targets: string[], hosts = anyHost) {
  return panelLinksOf(spec, search, { targets, hosts });
}

/**
 * A row's cell in the browser column.
 *
 * @param browser - The browser.
 * @returns The cell.
 */
function cell(browser: string) {
  return { row: { browser }, column: 'browser' };
}

const link = linkSchema.parse({
  dashboard: 'detail',
  variables: { browser: { column: 'browser' }, env: { variable: 'env' } },
});

test('a link to a pinned dashboard carries the row, the choices or defaults, and the time', () => {
  const links = linksOf('?from=now-1h&to=now', ['detail']);
  expect(hrefOf(link, links, cell('Safari'))?.href).toBe(
    '/d/detail?var-browser=Safari&var-env=prod&from=now-1h&to=now',
  );
  const chosen = linksOf('?var-env=staging', ['detail']);
  expect(hrefOf(link, chosen, cell('Safari'))).toEqual({
    href: '/d/detail?var-browser=Safari&var-env=staging&from=now-6h&to=now',
    external: false,
  });
});

test('a link to a dashboard not pinned now, or with no link drawn, gives none', () => {
  expect(hrefOf(link, linksOf('', []), cell('Safari'))).toBeUndefined();
  expect(hrefOf(link, undefined)).toBeUndefined();
  expect(hrefOf(undefined, linksOf('', ['detail']))).toBeUndefined();
});

test('a link to an address fills in the cell or a variable, encoded, outside the app', () => {
  const page = linkSchema.parse({ url: 'https://docs.example.com/browsers/{value}' });
  expect(hrefOf(page, linksOf('', []), cell('Safari 17/iOS'))).toEqual({
    href: 'https://docs.example.com/browsers/Safari%2017%2FiOS',
    external: true,
  });
  const env = linkSchema.parse({
    url: 'https://ops.example.com/?env={value}',
    value: { variable: 'env' },
  });
  expect(hrefOf(env, linksOf('?var-env=staging', []))?.href).toBe(
    'https://ops.example.com/?env=staging',
  );
});

test('a link to an address on a host not allowed, or with a dot segment, gives none', () => {
  const page = linkSchema.parse({ url: 'https://docs.example.com/browsers/{value}' });
  const listed = {
    links: { anyHost: false, hosts: ['media.example.com'] },
    images: { anyHost: false, hosts: [] },
  };
  expect(hrefOf(page, linksOf('', [], listed), cell('Safari'))).toBeUndefined();
  expect(hrefOf(page, linksOf('', []), cell('..'))).toBeUndefined();
  expect(hrefOf(page, linksOf('', []), cell(''))).toBeUndefined();
});
