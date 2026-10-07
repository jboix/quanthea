import { expect, test } from 'bun:test';
import { safeNext } from './safe-next.ts';

test('goes only to local paths after signing in', () => {
  expect(safeNext('/library?q=checkout')).toBe('/library?q=checkout');
  for (const unsafe of [
    '//evil.test',
    '/\\evil.test',
    'https://evil.test',
    'evil',
    '/login',
    '/set-password',
    '/api/auth/providers/okta/start?intent=link&next=/',
    '/library\\evil',
    '/a\nb',
    42,
    undefined,
    '',
    '/x/../api/auth/providers/okta/start?intent=link&next=/',
    '/x/%2e%2e/api/auth/x',
    '/%61pi/auth/providers/okta/start',
    '/x/../login',
    '/.//evil.test',
    '/x/..//evil.test',
    '/%zz',
    '/a/./b',
  ]) {
    expect(safeNext(unsafe)).toBe('/');
  }
});

test('keeps percent-encoding in the query, where nothing decodes it into a path', () => {
  expect(safeNext('/library?q=a%20b#top')).toBe('/library?q=a%20b#top');
  expect(safeNext('/a/b.c/..d')).toBe('/a/b.c/..d');
});
