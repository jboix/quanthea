import { expect, test } from 'bun:test';
import { copyTarget } from './section-copies.tsx';

test('a copy runs with its value for the repeated variable, and names itself', () => {
  const target = {
    dashboardId: 'd',
    version: 3,
    search: 'var-platform=web&var-platform=ios&from=now-1h',
    refresh: 0,
  };
  const copy = copyTarget(target, { variable: 'platform', value: 'ios' });
  expect(new URLSearchParams(copy.search).getAll('var-platform')).toEqual(['ios']);
  expect(new URLSearchParams(copy.search).get('from')).toBe('now-1h');
  expect(copy.copy).toBe('ios');
});
