import { expect, test } from 'bun:test';
import { hasPages, pageRange, pageStart } from './paging.ts';

test('says which entries a page shows, and how many there are in all', () => {
  expect(pageRange(0, 10, 57)).toBe('1–10 of 57');
  expect(pageRange(50, 7, 57)).toBe('51–57 of 57');
  expect(pageRange(56, 1, 57)).toBe('57 of 57');
  expect(pageRange(0, 0, 0)).toBe('0');
});

test('a list that fits its page needs no controls', () => {
  expect(hasPages(4, 4)).toBe(false);
  expect(hasPages(10, 11)).toBe(true);
});

test('a page of a list that shrank falls back to the last page it still has', () => {
  expect(pageStart(20, 10, 57)).toBe(20);
  expect(pageStart(50, 10, 31)).toBe(30);
  expect(pageStart(10, 10, 10)).toBe(0);
  expect(pageStart(10, 10, 0)).toBe(0);
});
