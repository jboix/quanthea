import { expect, test } from 'bun:test';
import { kindFrom, kindWords } from './thread-kinds.ts';

test('a link picks the alert kind with ?make=alert, and a dashboard otherwise', () => {
  expect(kindFrom('alert')).toBe('alert');
  expect(kindFrom(null)).toBe('dashboard');
  expect(kindFrom('nonsense')).toBe('dashboard');
  expect(kindWords.alert.examples.length).toBeGreaterThan(0);
});
