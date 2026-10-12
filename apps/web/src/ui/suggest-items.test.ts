import { describe, expect, test } from 'bun:test';
import { isSuggested, movedHighlight, suggestionsFor } from './suggest-items.ts';

const names = ['customers.email', 'customers.id', 'orders.customer_email', 'email_log.sent_at'];

describe('suggestionsFor', () => {
  test('lists every name when nothing is typed', () => {
    expect(suggestionsFor(names, '  ')).toEqual({ items: names, more: 0 });
  });

  test('keeps the names that hold every word typed, in any case', () => {
    expect(suggestionsFor(names, 'EMAIL customers').items).toEqual(['customers.email']);
  });

  test('puts the names that start with the text first', () => {
    expect(suggestionsFor(names, 'email').items).toEqual([
      'email_log.sent_at',
      'customers.email',
      'orders.customer_email',
    ]);
  });

  test('stops at the limit and counts the rest', () => {
    expect(suggestionsFor(names, '', 3)).toEqual({ items: names.slice(0, 3), more: 1 });
  });
});

describe('isSuggested', () => {
  test('finds a name in any case, trimmed', () => {
    expect(isSuggested(names, ' Customers.Email ')).toBe(true);
    expect(isSuggested(names, 'customers.phone')).toBe(false);
  });
});

describe('movedHighlight', () => {
  test('moves between the typed text and the last suggestion', () => {
    expect(movedHighlight(-1, 1, 3)).toBe(0);
    expect(movedHighlight(2, 1, 3)).toBe(2);
    expect(movedHighlight(0, -1, 3)).toBe(-1);
    expect(movedHighlight(-1, -1, 3)).toBe(-1);
    expect(movedHighlight(-1, 1, 0)).toBe(-1);
  });
});
