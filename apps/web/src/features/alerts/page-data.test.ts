import { expect, test } from 'bun:test';
import { type PageOutcome, withArrived } from './page-data.ts';

/** A page of two numbers. */
type Page = readonly number[];

const second = { before: 'c1', page: [3, 4] as Page };
const arrived: PageOutcome<Page> = { ok: true, before: 'c2', page: [5, 6] };

test('the page asked for goes under the pages already loaded', () => {
  expect(withArrived([second], 'c2', arrived)).toEqual([second, { before: 'c2', page: [5, 6] }]);
  expect(withArrived([], 'c2', arrived)).toEqual([{ before: 'c2', page: [5, 6] }]);
});

test('an answer is left out when no page is awaited, or another, or it failed', () => {
  expect(withArrived([second], undefined, arrived)).toBeUndefined();
  expect(withArrived([second], 'c3', arrived)).toBeUndefined();
  expect(withArrived([second], 'c2', undefined)).toBeUndefined();
  const refused: PageOutcome<Page> = { ok: false, before: 'c2', message: 'No alert a1.' };
  expect(withArrived([second], 'c2', refused)).toBeUndefined();
});
