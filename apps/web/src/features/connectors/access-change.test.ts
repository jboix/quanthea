import { describe, expect, test } from 'bun:test';
import {
  accessChangeOf,
  affectedThreadsPath,
  affectedThreadsWarning,
  narrowsAccess,
} from './access-change.ts';

const current = { accessLevel: 3 as const, hiddenFields: ['customers.email'] };

describe('narrowsAccess', () => {
  test('a lower level or a newly hidden field narrows', () => {
    expect(narrowsAccess(current, { ...current, accessLevel: 2 })).toBe(true);
    expect(narrowsAccess(current, { ...current, hiddenFields: ['customers.email', 'phone'] })).toBe(
      true,
    );
  });

  test('a higher level, a field shown again or a change of case does not', () => {
    expect(narrowsAccess(current, { ...current, accessLevel: 4 })).toBe(false);
    expect(narrowsAccess(current, { ...current, hiddenFields: [] })).toBe(false);
    expect(narrowsAccess(current, { ...current, hiddenFields: ['Customers.Email'] })).toBe(false);
  });
});

test('the path of the count carries the change, which reads back the same', () => {
  const change = { accessLevel: 1 as const, hiddenFields: ['a.b', 'c&d'] };
  const path = affectedThreadsPath('c1', change);
  expect(path.startsWith('/connectors/c1/affected-threads?')).toBe(true);
  const search = new URL(path, 'http://x').searchParams;
  expect(accessChangeOf(search)).toEqual(change);
  expect(accessChangeOf(new URLSearchParams())).toBeUndefined();
});

test('the warning counts the threads', () => {
  expect(affectedThreadsWarning(1)).toContain('1 thread holds');
  expect(affectedThreadsWarning(3)).toContain('3 threads hold');
  expect(affectedThreadsWarning(3)).toContain('model provider');
});
