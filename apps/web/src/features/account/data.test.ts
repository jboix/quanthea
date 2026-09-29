import { expect, test } from 'bun:test';
import { safeNext } from './data.ts';

test('goes only to local paths after signing in', () => {
  expect(safeNext('/library?q=checkout')).toBe('/library?q=checkout');
  for (const unsafe of [
    '//evil.test',
    '/\\evil.test',
    'https://evil.test',
    'evil',
    '/login',
    '/set-password',
    '/a\nb',
    42,
    undefined,
    '',
  ]) {
    expect(safeNext(unsafe)).toBe('/');
  }
});
