import { describe, expect, test } from 'bun:test';
import { type DashboardLink, linkAddress, linkSchema } from './links.ts';

describe('the address of a link', () => {
  const link = linkSchema.parse({
    dashboard: 'browser-detail',
    variables: { browser: { column: 'browser' }, env: { variable: 'env' }, kind: 'player' },
  }) as DashboardLink;

  test('takes a variable from the row, from the choices, or fixed, and keeps the time', () => {
    const address = linkAddress(link, {
      row: { browser: 'Firefox 120', plays: 3 },
      chosen: { env: 'prod' },
      time: { from: 'now-6h', to: 'now' },
    });
    expect(address).toBe(
      '/d/browser-detail?var-browser=Firefox%20120&var-env=prod&var-kind=player&from=now-6h&to=now',
    );
  });

  test('repeats a list, passes All on, and leaves the time out when told', () => {
    const own = { ...link, keepTime: false };
    const address = linkAddress(own, {
      row: { browser: null },
      chosen: { env: ['prod', 'staging'] },
      time: { from: 'now-6h', to: 'now' },
    });
    expect(address).toBe('/d/browser-detail?var-env=prod&var-env=staging&var-kind=player');
    expect(linkAddress(own, { chosen: { env: '$__all' } })).toContain('var-env=%24__all');
  });

  test('refuses a dashboard id with other characters', () => {
    expect(linkSchema.safeParse({ dashboard: '../x' }).success).toBe(false);
  });
});
