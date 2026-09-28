import { expect, test } from 'bun:test';
import { isValid } from 'ulid';
import { newId } from './ids.ts';

test('newId creates valid ULIDs that sort in creation order', () => {
  const ids = Array.from({ length: 1000 }, () => newId());
  ids.forEach((id) => {
    expect(isValid(id)).toBe(true);
  });
  expect([...ids].sort()).toEqual(ids);
  expect(new Set(ids).size).toBe(ids.length);
});
